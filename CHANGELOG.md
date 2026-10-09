# Changelog

## Unreleased

### Fixed
- A note copied or synced into the vault already done had its end date changed to the day it arrived. It now keeps the date it came with.

## 1.5.5

### New
- A **+** on each project row and group of the task board adds a task already in that project (and, inside a column, in that column's status). Right-click, or a long press on a phone, for *New task in this project*, *Open project* and *Pin*.

### Fixed
- A folded column's name lay flat and cut off on some setups ("ncel" for cancel), or ran into the count. It now runs down the bar just under the count.
- A long task or project title made a file name too long for Android to sync. New notes get names cut to fit; titles themselves stay whole.

## 1.5.4

### New
- Click a project's name on the task board, on a card or a project row, to open the project.
- **Timer without a task.** Start it from the clock in the status bar or the *Start a timer without a task* command, before knowing what the time is for. Stopping asks which task it was, an existing one or a new one by the title typed; *Choose task…* does it while it runs, and starting the timer on a task gives it that task.
- **Hide projects on the task board**, a setting: projects in these statuses, and their tasks, are left off the Kanban. Done, cancel and quite by default.

### Fixed
- On a right-to-left board grouped by project, a folded column's name sat at the bottom of the bar, out of sight.

## 1.5.3

### Fixed
- Saving a task or project said "Could not save … s.render is not a function" when a board was open in a tab not yet shown since Obsidian started. The note was saved; only the board refresh failed.
- For the same reason, deleting or editing logged time removed the time entry but left the task dialog's list and total as they were.

## 1.5.2

### Fixed
- When the board grouped by project was taller than the window, its rows were squeezed: cards overlapped and the status names at the top were cut off. Rows now keep their full height and the board scrolls, with the column heads staying in view.

## 1.5.1

### New
- **Pin projects** to the top of the grouped board. Tasks with no project come right after, ready to be given one; the other projects follow a new *Order of projects* setting (recent work, priority, unfinished tasks or name). Stored in the plugin settings, not in the notes.
- The names column beside the project rows can be dragged wider or narrower; double-click resets it.
- **What's new.** After an update, a window lists what changed since the version you had. Also a command, and a button and an off switch in settings.

### Fixed
- In project rows, a card with a long title spilled over the row lines.

## 1.5.0

### New
- **Group the task board by project.** A *By project* button on the Kanban; settings choose a row per project (the default) or groups inside each column. Groups fold and stay folded.
- **New task in backlog**, a command that opens the backlog column's "+" from anywhere.
- **Done on the overview.** Moving a task to done fills its `end` date, and the overview lists and counts the tasks finished in the period, whether or not time was logged on them.

### Fixed
- Deleting a task left its time entries behind, and their hours stayed in the reports.
- A date field low in a dialog had its calendar cut off.
- On a right-to-left board, the projects board's toolbar still ran left to right.

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
