package web

import "testing"

func TestRejectedModelProvider(t *testing.T) {
	cases := map[string]string{
		`invalid_request_error: kiro generateAssistantResponse HTTP 400: {"message":"Invalid model. Please select a different model to continue.","reason":"INVALID_MODEL_ID"}`: "kiro",
		`permission_error: kiro generateAssistantResponse HTTP 403: {"message":"The bearer token included in the request is invalid."}`:                                         "",
		`not_found_error: model: claude-sonnet-4-20250514`: "",
		`Resource has been exhausted (e.g. check quota).`:  "",
	}
	for msg, want := range cases {
		if got := RejectedModelProvider(msg); got != want {
			t.Errorf("%q -> %q, want %q", msg, got, want)
		}
	}
}

func TestBaseModelName(t *testing.T) {
	for in, want := range map[string]string{
		"claude-sonnet-4-6":         "claude-sonnet-4-6",
		"claude-opus-4-6(high)":     "claude-opus-4-6",
		"claude-cartelink-main[1m]": "claude-cartelink-main",
		" gemini-3.8-flash-high ":   "gemini-3.8-flash-high",
	} {
		if got := BaseModelName(in); got != want {
			t.Errorf("%q -> %q, want %q", in, got, want)
		}
	}
}

func TestIsContentFilterError(t *testing.T) {
	if !IsContentFilterError(`content_filter_error: I'm sorry, but I can't help with that request.`) {
		t.Fatal("content_filter not detected")
	}
	if IsContentFilterError(`Resource has been exhausted (e.g. check quota).`) {
		t.Fatal("quota error taken for a content filter")
	}
}
