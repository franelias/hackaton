package notify

import (
	"context"
	"errors"
	"fmt"

	"firebase.google.com/go/v4/messaging"
)

// FCM pushes through Firebase Cloud Messaging. Messages are data-only: the
// service worker web/public/firebase-messaging-sw.js shows them (onBackgroundMessage).
type FCM struct{ Client *messaging.Client }

func (f FCM) Push(ctx context.Context, tokens []string, m Message) (int, []string, error) {
	resp, err := f.Client.SendEachForMulticast(ctx, &messaging.MulticastMessage{
		Tokens: tokens,
		Data:   map[string]string{"title": m.Title, "body": m.Body, "url": m.URL},
		// A reminder older than a day is noise.
		Webpush: &messaging.WebpushConfig{Headers: map[string]string{"TTL": "86400", "Urgency": "normal"}},
	})
	if err != nil {
		return 0, nil, err
	}
	var stale []string
	var errs []error
	for i, r := range resp.Responses {
		switch {
		case r.Success:
		case messaging.IsUnregistered(r.Error) || messaging.IsInvalidArgument(r.Error):
			stale = append(stale, tokens[i])
		default:
			errs = append(errs, fmt.Errorf("token %.12s…: %w", tokens[i], r.Error))
		}
	}
	return resp.SuccessCount, stale, errors.Join(errs...)
}
