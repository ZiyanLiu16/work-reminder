# Reviewer test instructions

No account, server, API key, or paid feature is required.

1. Install the extension. Its settings page opens automatically.
2. Enter any temporary goal, for example: `Finish the current draft`.
3. Set the reminder interval to `0.5` minute and save.
4. Open or refresh `https://www.youtube.com/` and keep Chrome in the foreground.
5. After approximately 30–60 seconds, a reminder card appears at the lower-right corner of the page.
6. Click `再看 5 分钟` to dismiss it, or open the toolbar popup to inspect the current timer.
7. To test custom websites, open the settings page, edit the website list, add a domain, save it, and accept Chrome's site-access prompt. The extension requests only the entered domain at that moment.

Optional project-import testing:

1. In step 2 of the settings page, choose a local folder containing ordinary text or source-code files.
2. Review the extracted snippets and select one or more before saving.
3. Click `预览下一种提醒` until the project reminder appears.

The project import runs entirely in the settings page. It does not execute files and does not upload their contents.
