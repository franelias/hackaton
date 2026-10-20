// Package notify sends the tree's nudges (tree.Nudges) outside the app, by
// push (FCM) and mail, Duolingo style: each condition once, at most PerDay a
// day per student, and only at reasonable hours of Argentina.
package notify

import (
	"context"
	"errors"
	"fmt"
	"log"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
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
//
// Students are handled in batches whose data is loaded in a few queries, not
// a few per student: the database is remote and a round trip is what costs.
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
	plans := map[planKey]*db.Plan{} // the plan is the same for every student of a career
	var errs []error
	for batch := range slices.Chunk(students, batchSize) {
		if err := ctx.Err(); err != nil {
			return sent, err
		}
		got, err := n.batch(ctx, batch, plans, now)
		sent += got
		if err != nil {
			errs = append(errs, err)
		}
	}
	return sent, errors.Join(errs...)
}

const (
	batchSize = 200 // students loaded at once
	workers   = 8   // students handled at once; the database pool holds 10
)

type planKey struct {
	faculty string
	career  int
}

// batch sends the due nudges of the students and returns how many got one.
func (n *Notifier) batch(ctx context.Context, students []db.Student, plans map[planKey]*db.Plan, now time.Time) (int, error) {
	ids := make([]int, len(students))
	for i, st := range students {
		ids[i] = st.ID
	}
	today, err := n.sentToday(ids, now)
	if err != nil {
		return 0, err
	}
	var due []*db.Student
	var dueIDs, pushIDs []int
	for i, st := range students {
		if today[st.ID] >= PerDay {
			continue
		}
		due = append(due, &students[i])
		dueIDs = append(dueIDs, st.ID)
		if st.NotifyPush && n.Push != nil {
			pushIDs = append(pushIDs, st.ID)
		}
	}
	if len(due) == 0 {
		return 0, nil
	}

	var missing []planKey
	for _, st := range due {
		if k := (planKey{st.Faculty, st.CareerID}); plans[k] == nil && !slices.Contains(missing, k) {
			missing = append(missing, k)
		}
	}
	var rows map[int]*db.Rows
	tokens := map[int][]string{}
	loaded := make([]*db.Plan, len(missing))
	loads := []func() error{
		func() (err error) { rows, err = db.LoadRows(n.DB, dueIDs); return err },
		func() error { return n.loadTokens(pushIDs, tokens) },
	}
	for i, k := range missing {
		loads = append(loads, func() (err error) { loaded[i], err = db.LoadPlan(n.DB, k.faculty, k.career); return err })
	}
	if err := db.Parallel(loads...); err != nil {
		return 0, err
	}
	for i, k := range missing {
		plans[k] = loaded[i]
	}

	var sent atomic.Int64
	var wg sync.WaitGroup
	sem := make(chan struct{}, workers)
	for _, st := range due {
		if ctx.Err() != nil {
			break
		}
		sem <- struct{}{}
		wg.Go(func() {
			defer func() { <-sem }()
			r := rows[st.ID]
			if r == nil {
				r = &db.Rows{}
			}
			in := plans[planKey{st.Faculty, st.CareerID}].Input(st, *r, now)
			ok, err := n.student(ctx, st, in, tokens[st.ID])
			if err != nil {
				log.Printf("notify s-%03d: %v", st.ID, err)
			}
			if ok {
				sent.Add(1)
			}
		})
	}
	wg.Wait()
	return int(sent.Load()), ctx.Err()
}

// sentToday counts the reminders each student got today (Argentina).
func (n *Notifier) sentToday(ids []int, now time.Time) (map[int]int, error) {
	y, m, d := now.In(loc).Date()
	var rows []struct{ StudentID, N int }
	err := n.DB.Model(&db.Notification{}).Select("student_id, count(*) AS n").
		Where("student_id IN ? AND sent_at >= ?", ids, time.Date(y, m, d, 0, 0, 0, 0, loc)).
		Group("student_id").Scan(&rows).Error
	out := make(map[int]int, len(rows))
	for _, r := range rows {
		out[r.StudentID] = r.N
	}
	return out, err
}

// loadTokens adds the push tokens of the students to out, by student.
func (n *Notifier) loadTokens(ids []int, out map[int][]string) error {
	if len(ids) == 0 {
		return nil
	}
	var rows []db.PushToken
	if err := n.DB.Find(&rows, "student_id IN ?", ids).Error; err != nil {
		return err
	}
	for _, t := range rows {
		out[t.StudentID] = append(out[t.StudentID], t.Token)
	}
	return nil
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

// student sends the first nudge not sent yet, if the student has a channel.
// The caller checked the daily cap and loaded the tree input and push tokens.
func (n *Notifier) student(ctx context.Context, st *db.Student, in tree.Input, tokens []string) (bool, error) {
	nudges := tree.Nudges(in)
	if len(nudges) == 0 {
		return false, nil
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
