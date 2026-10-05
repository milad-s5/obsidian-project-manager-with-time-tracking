# Changelog

## 1.3.0

### New
- **Notes inside the task and project dialogs.** Open a task or project and read or write its note right there, with no need to open the note file. Reading shows the note rendered (links, lists, checkboxes); click it or the pencil to edit in Obsidian's own editor, so checkboxes and formatting look the same while you write. Notes are saved with **Save**, and you can write one while creating a new task or project too.
  The note is the text between the title and the Time Log in the note file, so notes you already wrote there show up in the dialog.
- **A + on every board column.** Creates a task (on the Kanban) or a project (on the Projects board) already set to that column's status. It also picks up the board's priority filter, and on the Kanban the project filter, so the new card shows up right where you clicked.

### Fixed
- Card details showed a literal `\00b7` instead of the · separator.
