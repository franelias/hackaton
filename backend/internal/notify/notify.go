// Package notify sends the tree's nudges (tree.Nudges) outside the app, by
// push (FCM) and mail, Duolingo style: each condition once, at most PerDay a
// day per student, and only at reasonable hours of Argentina.
package notify

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"firebase.google.com/go/v4/auth"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/franelias/hackaton/backend/internal/db"
	"github.com/franelias/hackaton/backend/internal/tree"
)

// Message is one reminder, already in Spanish.
type Message struct {
	Title string
	Body  string
	URL   string // opens the app where the nudge's action is
}

type Pusher interface {
	// Push sends m to the tokens. It returns how many got it and the tokens
	// that are no longer valid (to forget them).
	Push(ctx context.Context, tokens []string, m Message) (sent int, stale []string, err error)
}

type Mailer interface {
	Mail(ctx context.Context, to, name string, m Message) error
}

// Users finds a student's mail in Firebase. *auth.Client implements it.
type Users interface {
	GetUser(ctx context.Context, uid string) (*auth.UserRecord, error)
}

// Send window in Argentina time, and nudges per student per day.
const (
	FromHour = 10
	ToHour   = 21
	PerDay   = 1
)

var loc, _ = time.LoadLocation("America/Argentina/Buenos_Aires")

type Notifier struct {
	DB    *gorm.DB
	Push  Pusher // nil: no push
	Mail  Mailer // nil: no mail
	Users Users  // nil: no mail
	// AppURL is the web app's base URL, for the links.
	AppURL string
	Now    func() time.Time
}

type Options struct {
	AnyHour   bool // ignore the send window (manual runs, demo)
	StudentID int  // only this student; 0 for all
}

// Run sends the due nudges once and returns how many students got one. A
// failure with one student is logged and does not stop the others.
func (n *Notifier) Run(ctx context.Context, opt Options) (int, error) {
	now := n.Now()
	if h := now.In(loc).Hour(); !opt.AnyHour && (h < FromHour || h >= ToHour) {
		return 0, nil
	}
	q := n.DB.Where("notify_push OR notify_email")
	if opt.StudentID != 0 {
		q = q.Where("id = ?", opt.StudentID)
	}
	var students []db.Student
	if err := q.Order("id").Find(&students).Error; err != nil {
		return 0, err
	}
	sent := 0
	for i := range students {
		if err := ctx.Err(); err != nil {
			return sent, err
		}
		ok, err := n.student(ctx, &students[i], now)
		if err != nil {
			log.Printf("notify s-%03d: %v", students[i].ID, err)
		}
		if ok {
			sent++
		}
	}
	return sent, nil
}

// Loop runs Run every interval until ctx is done.
func (n *Notifier) Loop(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		if sent, err := n.Run(ctx, Options{}); err != nil && ctx.Err() == nil {
			log.Printf("notify: %v", err)
		} else if sent > 0 {
			log.Printf("notify: %d students nudged", sent)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// student sends the first nudge not sent yet, if the student has a channel
// and did not get one today.
func (n *Notifier) student(ctx context.Context, st *db.Student, now time.Time) (bool, error) {
	y, m, d := now.In(loc).Date()
	var today int64
	if err := n.DB.Model(&db.Notification{}).Where("student_id = ? AND sent_at >= ?", st.ID, time.Date(y, m, d, 0, 0, 0, 0, loc)).Count(&today).Error; err != nil {
		return false, err
	}
	if today >= PerDay {
		return false, nil
	}
	in, err := db.TreeInput(n.DB, st, now)
	if err != nil {
		return false, err
	}
	nudges := tree.Nudges(in)
	if len(nudges) == 0 {
		return false, nil
	}

	var tokens []string
	if st.NotifyPush && n.Push != nil {
		if err := n.DB.Model(&db.PushToken{}).Where("student_id = ?", st.ID).Pluck("token", &tokens).Error; err != nil {
			return false, err
		}
	}
	var email string
	if st.NotifyEmail && n.Mail != nil && n.Users != nil {
		u, err := n.Users.GetUser(ctx, st.FirebaseUID)
		switch {
		case err != nil:
			log.Printf("notify s-%03d: firebase user: %v", st.ID, err)
		case !u.Disabled:
			email = u.Email
		}
	}
	if len(tokens) == 0 && email == "" {
		return false, nil // nothing claimed: it can go out once a channel is on
	}

	for _, nu := range nudges {
		// Claim the condition first, so two runs never send it twice.
		row := db.Notification{StudentID: st.ID, Kind: nu.Kind, SubjectID: nu.SubjectID, CondKey: nu.Key, Title: nu.Title, Body: nu.Body}
		res := n.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
		if res.Error != nil {
			return false, res.Error
		}
		if res.RowsAffected == 0 {
			continue // already sent
		}
		msg := Message{Title: nu.Title, Body: nu.Body, URL: n.link(nu.Action)}
		delivered, stale, err := n.deliver(ctx, tokens, email, st.Name, msg)
		errs := []error{err}
		if len(stale) > 0 {
			if err := n.DB.Delete(&db.PushToken{}, "token IN ?", stale).Error; err != nil {
				errs = append(errs, err)
			}
		}
		if !delivered {
			// Release the claim so the next run retries it.
			if err := n.DB.Delete(&row).Error; err != nil {
				errs = append(errs, err)
			}
			return false, errors.Join(append(errs, errors.New("no channel delivered"))...)
		}
		return true, errors.Join(errs...)
	}
	return false, nil
}

// deliver sends msg by push to the tokens and by mail to email (when not
// empty). It is delivered when at least one push or one real mail went out; a
// mail that LogMailer only logged does not count. It returns the stale tokens
// to forget and every failure, per token and per channel.
func (n *Notifier) deliver(ctx context.Context, tokens []string, email, name string, msg Message) (bool, []string, error) {
	var errs []error
	var stale []string
	delivered := false
	if len(tokens) > 0 {
		sent, s, err := n.Push.Push(ctx, tokens, msg)
		if err != nil {
			errs = append(errs, fmt.Errorf("push: %w", err))
		}
		if len(s) > 0 {
			errs = append(errs, fmt.Errorf("push: %d stale tokens forgotten", len(s)))
		}
		delivered, stale = sent > 0, s
	}
	if email != "" {
		if err := n.Mail.Mail(ctx, email, name, msg); err != nil {
			errs = append(errs, fmt.Errorf("mail: %w", err))
		} else {
			delivered = true
		}
	}
	return delivered, stale, errors.Join(errs...)
}

// link opens the app where the action of a nudge is.
func (n *Notifier) link(a tree.Action) string {
	base := strings.TrimRight(n.AppURL, "/")
	switch a.Type {
	case "open_tutor", "contact_tutor":
		if a.SubjectID != nil {
			return fmt.Sprintf("%s/tutor?subject=%d", base, *a.SubjectID)
		}
		return base + "/tutor"
	case "build_schedule":
		return base + "/schedule"
	}
	return base + "/"
}
