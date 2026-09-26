package main

import (
	"reflect"
	"testing"
)

func TestOpenedFilesSurviveUntilFrontendDrains(t *testing.T) {
	service := &NativeService{}
	service.enqueueFile("/tmp/first document.md")
	service.enqueueFile("/tmp/日本語.MARKDOWN")
	if got, want := service.TakeOpenedFiles(), []string{"/tmp/first document.md", "/tmp/日本語.MARKDOWN"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("opened files = %v, want %v", got, want)
	}
	if got := service.TakeOpenedFiles(); len(got) != 0 {
		t.Fatalf("already delivered files repeated: %v", got)
	}
	service.enqueueFile("/tmp/first document.md")
	if got, want := service.TakeOpenedFiles(), []string{"/tmp/first document.md"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("subsequent open = %v, want %v", got, want)
	}
}
