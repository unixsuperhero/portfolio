package main

import (
	"embed"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
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
	native := &NativeService{}
	app := application.New(application.Options{
		Name:        "Portfolio",
		Description: "Portfolio desktop: library, dashboards, browser, terminal",
		Services: []application.Service{
			application.NewService(&SidecarService{}),
			application.NewService(&PtyService{}),
			application.NewService(native),
		},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets),
			Middleware: apiProxy(sidecarURL),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	windowOptions := application.WebviewWindowOptions{
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
		DevToolsEnabled:  true,
		// PORTFOLIO_INSPECT=1 opens the WebKit inspector with the window, for debugging the page.
		OpenInspectorOnStartup: os.Getenv("PORTFOLIO_INSPECT") == "1",
	}
	windowOptions.Mac.WebviewPreferences.TabFocusesLinks.Set(true)
	window := app.Window.NewWithOptions(windowOptions)
	app.Event.OnApplicationEvent(events.Common.ApplicationOpenedWithFile, func(event *application.ApplicationEvent) {
		native.enqueueFile(event.Context().Filename())
		app.Event.Emit("native:files-opened")
		window.Show()
		window.Focus()
	})

	// A SIGTERM or SIGINT (a killed dev run, a stopped launcher) quits through
	// the application so services shut down and the sidecar is not orphaned.
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-signals
		app.Quit()
	}()

	// Run the application. This blocks until the application has been exited.
	err := app.Run()

	// If an error occurred while running the application, log it and exit.
	if err != nil {
		log.Fatal(err)
	}
}
