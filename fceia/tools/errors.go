package tools

import (
	"encoding/json"
	"errors"

	"github.com/franelias/hackaton/fceia"
)

// Error codes from the shared contract (docs/contratos.md §0).
const (
	CodeNotFound       = "not_found"
	CodeAPIUnavailable = "api_unavailable"
	CodeInvalidArg     = "invalid_argument"
)

type invalidArgument string

func (e invalidArgument) Error() string { return string(e) }

// Code is the contract error code of an error returned by a tool.
func Code(err error) string {
	var inv invalidArgument
	switch {
	case errors.As(err, &inv):
		return CodeInvalidArg
	case errors.Is(err, fceia.ErrNotFound):
		return CodeNotFound
	}
	return CodeAPIUnavailable
}

type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ErrorJSON renders err as {"error":{"code","message"}}.
func ErrorJSON(err error) string {
	b, _ := json.Marshal(errorBody{Error: errorDetail{Code: Code(err), Message: err.Error()}})
	return string(b)
}
