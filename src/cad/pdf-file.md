# PDF selection in the desktop app

PDFIMPORT uses the native open dialog and readFileBinary, matching the successful
Finder/Explorer drop path. HTML File input is retained only for the web app or
hosts without the native bridge. Existing drops take priority; cancel is a no-op;
read errors are reported by the command and never retried through text decoding.

Regression: macOS desktop 0.3.61 rejected a PDF via the command with Invalid PDF
structure while the identical file imported through Finder drag. Independent
PDF.js parsing succeeded. This isolates the failing input route, not the exact
underlying WebKit failure. No claim of reproducing the native failure in Node.

Tests cover all 256 byte values, typed-array offsets, Unicode names, cancellation,
read failures, browser fallback, existing drops and the real PDFIMPORT command.
The command regression fails against the previous implementation. Validate the
signed macOS build with the original file before claiming end-user confirmation.
