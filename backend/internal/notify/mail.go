package notify

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"html/template"
	"log"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/mail"
	"net/smtp"
	"strings"
	"time"
)

// SMTP sends mail through a relay (STARTTLS when offered, PLAIN auth when
// User is set). In development, Mailpit from docker-compose.yml.
type SMTP struct {
	Addr     string // host:port
	User     string
	Password string
	From     string // "Árbol <recordatorios@example.com>"
	// AppURL is where students turn reminders off (Mi cuenta).
	AppURL string
}

func (s SMTP) Mail(ctx context.Context, to, name string, m Message) error {
	from, err := mail.ParseAddress(s.From)
	if err != nil {
		return fmt.Errorf("MAIL_FROM: %w", err)
	}
	msg, err := compose(from, to, name, m, strings.TrimRight(s.AppURL, "/")+"/cuenta")
	if err != nil {
		return err
	}
	host, _, err := net.SplitHostPort(s.Addr)
	if err != nil {
		return err
	}
	conn, err := (&net.Dialer{Timeout: 10 * time.Second}).DialContext(ctx, "tcp", s.Addr)
	if err != nil {
		return err
	}
	conn.SetDeadline(time.Now().Add(30 * time.Second))
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		conn.Close()
		return err
	}
	defer c.Close()
	if ok, _ := c.Extension("STARTTLS"); ok {
		if err := c.StartTLS(&tls.Config{ServerName: host}); err != nil {
			return err
		}
	}
	if s.User != "" {
		if err := c.Auth(smtp.PlainAuth("", s.User, s.Password, host)); err != nil {
			return err
		}
	}
	if err := c.Mail(from.Address); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

// LogMailer prints the mail instead of sending it (no SMTP_ADDR).
type LogMailer struct{}

func (LogMailer) Mail(_ context.Context, to, _ string, m Message) error {
	log.Printf("mail to %s: %s | %s | %s", to, m.Title, m.Body, m.URL)
	return nil
}

var page = template.Must(template.New("mail").Parse(`<!doctype html>
<html lang="es"><body style="margin:0;background:#f6f4ec;font-family:Helvetica,Arial,sans-serif;color:#24301f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:20px;border:1px solid #e3e0d2">
<tr><td style="padding:28px 28px 8px;font-size:15px;font-weight:bold;color:#456d42">🌳 Árbol</td></tr>
<tr><td style="padding:8px 28px 0;font-size:15px">Hola {{.Name}},</td></tr>
<tr><td style="padding:12px 28px 0;font-size:22px;font-weight:bold;line-height:1.3">{{.Title}}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:16px;line-height:1.5">{{.Body}}</td></tr>
<tr><td style="padding:24px 28px 28px"><a href="{{.URL}}" style="display:inline-block;background:#456d42;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:999px">Abrir Árbol</a></td></tr>
</table>
<p style="max-width:480px;font-size:12px;color:#7a7f72;line-height:1.5;padding:16px 8px 0;margin:0">Te escribimos porque tenés los recordatorios por mail activados. Podés apagarlos en <a href="{{.Settings}}" style="color:#7a7f72">Mi cuenta</a>.</p>
</td></tr></table></body></html>`))

// compose builds a multipart/alternative message (text and HTML), UTF-8.
func compose(from *mail.Address, to, name string, m Message, settings string) ([]byte, error) {
	if name == "" {
		name = "¿cómo va?"
	}
	var html bytes.Buffer
	if err := page.Execute(&html, map[string]string{"Name": name, "Title": m.Title, "Body": m.Body, "URL": m.URL, "Settings": settings}); err != nil {
		return nil, err
	}
	text := fmt.Sprintf("Hola %s,\n\n%s\n\n%s\n\nAbrí Árbol: %s\n\n--\nTe escribimos porque tenés los recordatorios por mail activados. Podés apagarlos en Mi cuenta: %s\n", name, m.Title, m.Body, m.URL, settings)

	var id [12]byte
	rand.Read(id[:])
	boundary := "arbol-" + hex.EncodeToString(id[:])
	var b bytes.Buffer
	fmt.Fprintf(&b, "From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMessage-ID: <%s@%s>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=%q\r\n\r\n",
		from.String(), to, mime.QEncoding.Encode("utf-8", m.Title), time.Now().Format(time.RFC1123Z), hex.EncodeToString(id[:]), domain(from.Address), boundary)
	for _, part := range []struct{ typ, body string }{{"text/plain", text}, {"text/html", html.String()}} {
		fmt.Fprintf(&b, "--%s\r\nContent-Type: %s; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n", boundary, part.typ)
		qp := quotedprintable.NewWriter(&b)
		qp.Write([]byte(part.body))
		qp.Close()
		b.WriteString("\r\n")
	}
	fmt.Fprintf(&b, "--%s--\r\n", boundary)
	return b.Bytes(), nil
}

func domain(addr string) string {
	if i := strings.LastIndexByte(addr, '@'); i >= 0 {
		return addr[i+1:]
	}
	return "arbol"
}
