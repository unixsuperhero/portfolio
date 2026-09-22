package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

func init() {
	// Register the custom events emitted by PtyService, so the binding
	// generator produces a strongly typed JS/TS API for them.
	application.RegisterEvent[PtyDataEvent]("pty:data")
	application.RegisterEvent[PtyExitEvent]("pty:exit")
}

// main function serves as the application's entry point. It initializes the
// application, registers the desktop services and one main window, and runs
// the application until it exits.
func main() {
	app := application.New(application.Options{
		Name:        "Portfolio",
		Description: "Portfolio desktop: library, dashboards, browser, terminal",
		Services: []application.Service{
			application.NewService(&SidecarService{}),
			application.NewService(&PtyService{}),
			application.NewService(&BrowserService{}),
			application.NewService(&NativeService{}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Portfolio",
		Width:  1400,
		Height: 900,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(6, 7, 15),
		URL:              "/",
	})

	// Run the application. This blocks until the application has been exited.
	err := app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
