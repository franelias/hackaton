package notify

import (
	"context"
	"errors"
	"mime"
	"net/mail"
	"strings"
	"testing"

	"github.com/franelias/hackaton/backend/internal/tree"
)

func TestLink(t *testing.T) {
	n := &Notifier{AppURL: "https://arbol.app/"}
	cases := map[string]tree.Action{
		"https://arbol.app/tutor?subject=12": {Type: "open_tutor", SubjectID: new(12)},
		"https://arbol.app/tutor":            {Type: "contact_tutor"},
		"https://arbol.app/schedule":         {Type: "build_schedule"},
		"https://arbol.app/":                 {Type: "view_dates"},
	}
	for want, a := range cases {
		if got := n.link(a); got != want {
			t.Errorf("%+v: got %s, want %s", a, got, want)
		}
	}
}

func TestCompose(t *testing.T) {
	from, _ := mail.ParseAddress("Árbol <recordatorios@arbol.app>")
	m := Message{Title: "🔥 Tu racha está en juego", Body: "Llevás <3> semanas.", URL: "https://arbol.app/tutor"}
	raw, err := compose(from, "beto@arbol.demo", "Beto", m, "https://arbol.app/account")
	if err != nil {
		t.Fatal(err)
	}
	msg, err := mail.ReadMessage(strings.NewReader(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	subject, err := new(mime.WordDecoder).DecodeHeader(msg.Header.Get("Subject"))
	if err != nil || subject != m.Title {
		t.Errorf("subject %q (%v)", subject, err)
	}
	if msg.Header.Get("To") != "beto@arbol.demo" || !strings.HasPrefix(msg.Header.Get("Content-Type"), "multipart/alternative") {
		t.Errorf("headers %v", msg.Header)
	}
	body := string(raw)
	// the HTML part escapes the text it gets
	if !strings.Contains(body, "&lt;3&gt;") || !strings.Contains(body, "Hola Beto") || !strings.Contains(body, "arbol.app/account") {
		t.Errorf("body:\n%s", body)
	}
}

type fakePush struct {
	sent  int
	stale []string
	err   error
}

func (f fakePush) Push(context.Context, []string, Message) (int, []string, error) {
	return f.sent, f.stale, f.err
}

type fakeMail struct{ err error }

func (f fakeMail) Mail(context.Context, string, string, Message) error { return f.err }

func TestDeliver(t *testing.T) {
	failed := errors.New("token abc…: sender id mismatch")
	cases := []struct {
		name      string
		push      fakePush
		mail      Mailer
		tokens    []string
		email     string
		delivered bool
		stale     int
		errs      []string
	}{
		{"push ok", fakePush{sent: 1}, nil, []string{"a"}, "", true, 0, nil},
		{"push failed is reported", fakePush{err: failed}, nil, []string{"a"}, "", false, 0, []string{"sender id mismatch"}},
		{"stale tokens are returned and reported", fakePush{stale: []string{"a"}}, nil, []string{"a"}, "", false, 1, []string{"1 stale"}},
		{"logged mail is not delivered", fakePush{}, LogMailer{}, nil, "beto@arbol.demo", false, 0, []string{"no SMTP_ADDR"}},
		{"real mail is delivered", fakePush{}, fakeMail{}, nil, "beto@arbol.demo", true, 0, nil},
		{"mail saves a failed push", fakePush{err: failed}, fakeMail{}, []string{"a"}, "beto@arbol.demo", true, 0, []string{"sender id mismatch"}},
	}
	for _, c := range cases {
		n := &Notifier{Push: c.push, Mail: c.mail}
		delivered, stale, err := n.deliver(context.Background(), c.tokens, c.email, "Beto", Message{})
		if delivered != c.delivered || len(stale) != c.stale {
			t.Errorf("%s: delivered %v stale %d, want %v %d", c.name, delivered, len(stale), c.delivered, c.stale)
		}
		if (err != nil) != (len(c.errs) > 0) {
			t.Errorf("%s: err %v", c.name, err)
		}
		for _, want := range c.errs {
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Errorf("%s: err %v, want it to mention %q", c.name, err, want)
			}
		}
	}
}
