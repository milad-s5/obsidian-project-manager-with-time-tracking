# Changelog

## 1.4.0

### New
- **Timer in the status bar.** While a timer runs, the status bar shows its task and time; click it to pause, resume, stop, reset or open the task.
- **Pomodoro.** Optional rounds on top of the timer: it pauses for a break after each work round and resumes afterwards. Finished rounds are counted on the task and shown on its card. Lengths are settings.
- **Edit logged time.** The task dialog lists every logged session; change its day, start or length, or delete it, and the time entry note, the Time Log row and the task's and project's totals change together.
- **Full screen boards.** A button on both boards hides everything but the board. One shared switch, remembered across restarts; Esc leaves it.
- **Right-to-left boards.** A setting mirrors the Kanban and the projects board.
- **Closed statuses** are a setting, and **Rename a status** renames a status in settings and in every note.
- **Rebuild totals from logged time**, a command that recounts every task's and project's totals.
- A project's `hours` and `task_count` now stay up to date as its tasks change.

### Fixed
- Marking a task done (which archives it) while its timer ran lost the whole session when the timer was stopped.
- Pressing Stop twice, or Stop in two views, logged the same session twice. Add Entry had the same problem.
- Manual entries landed on the previous day west of UTC, and their Time Log row always said today.
- Stopping a timer from another workspace's board filed the time entry in that workspace.
- Saving a task whose project was archived wiped the task's project link.
- A project title ending in a space could not be picked for a new task ("No open project"). (#1)
- A project title with a quote broke its frontmatter; a second project with the same title, or a title in a script other than Latin or Persian, could not be saved, and the dialog said nothing.
- A new task could get the same note name as an archived one, which mixed up their hours in the reports.
- Renaming a workspace left all of its notes behind and emptied its board.
- The Kanban redrew itself on every change anywhere in the vault and jumped back to the top.
- Two entries logged in quick succession could lose one from the task's total.
- Kanban cards turned overdue by the UTC date instead of the local one.
- Jalali dates were drawn in the wrong order inside left-to-right text ("مهر ۱۴۰۵ ۱۴").
- Dashboard tables said "Jalali" for Gregorian dates.
- A capitalised status had no tasks in its column until Obsidian restarted.
- Cards and lists showed a project's file name instead of its title.
- Workspace folder settings applied on every keystroke and created nothing until a restart; removing a workspace now asks first.
- A card dropped on the other board had that board's status written into it.
- API methods failed when called on their own (`const { ensureProject } = api`).

### Changed
- The Date format setting, which nothing used, is gone.
- Command and view names use sentence case, and the two ribbon buttons have their own icons.

## 1.3.1

### Fixed
- Code cleanup so the plugin passes the Obsidian community directory review again. No change in behavior.

## 1.3.0

### New
- **Notes inside the task and project dialogs.** Open a task or project and read or write its note right there, with no need to open the note file. Reading shows the note rendered (links, lists, checkboxes); click it or the pencil to edit in Obsidian's own editor, so checkboxes and formatting look the same while you write. Notes are saved with **Save**, and you can write one while creating a new task or project too.
  The note is the text between the title and the Time Log in the note file, so notes you already wrote there show up in the dialog.
- **A + on every board column.** Creates a task (on the Kanban) or a project (on the Projects board) already set to that column's status. It also picks up the board's priority filter, and on the Kanban the project filter, so the new card shows up right where you clicked.

### Fixed
- Card details showed a literal `\00b7` instead of the · separator.
