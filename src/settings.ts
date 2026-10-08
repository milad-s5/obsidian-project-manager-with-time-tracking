import { App, Notice, normalizePath, PluginSettingTab, Setting, TextComponent } from "obsidian";
import ProjectManagerPlugin from "./main";
import { DeleteBehaviour, ProjectOrder } from "./types";
import { defaultArchiveFolder } from "./utils/WorkspacePaths";
import { CalendarKind, WeekStart } from "./utils/Calendar";
import { RenameStatusModal } from "./views/RenameStatusModal";
import { ConfirmModal } from "./views/ConfirmModal";

export class ProjectManagerSettingTab extends PluginSettingTab {
  plugin: ProjectManagerPlugin;

  constructor(app: App, plugin: ProjectManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();


    // Default workspace
    new Setting(containerEl)
      .setName("Default workspace")
      .setDesc("Which workspace to open by default")
      .addDropdown((drop) => {
        this.plugin.settings.workspaces.forEach((ws) => {
          drop.addOption(ws.id, ws.name);
        });
        drop.setValue(this.plugin.settings.defaultWorkspaceId);
        drop.onChange(async (value) => {
          this.plugin.settings.defaultWorkspaceId = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Calendar")
      .setDesc("Which calendar the dashboard, the overview and the reports count and label in.")
      .addDropdown((drop) => {
        drop.addOption("gregorian", "Gregorian");
        drop.addOption("jalali", "Jalali (Persian)");
        drop.setValue(this.plugin.settings.calendar);
        drop.onChange(async (value) => {
          this.plugin.settings.calendar = value as CalendarKind;
          await this.plugin.saveSettings();
          this.plugin.refreshTimerViews();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Deleting a task or project")
      .setDesc(
        "Trash follows this vault's own setting for deleted files, so they can be " +
          "recovered. Delete permanently removes the note outright."
      )
      .addDropdown((drop) => {
        drop.addOption("trash", "Move to trash");
        drop.addOption("permanent", "Delete permanently");
        drop.setValue(this.plugin.settings.deleteBehaviour);
        drop.onChange(async (value) => {
          this.plugin.settings.deleteBehaviour = value as DeleteBehaviour;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Board direction")
      .setDesc(
        "Right to left mirrors both boards, the Kanban and the projects board: the first column " +
          "starts on the right, and cards and the toolbar read right to left. Dialogs and the " +
          "other dashboard tabs are not affected."
      )
      .addDropdown((drop) => {
        drop.addOption("ltr", "Left to right");
        drop.addOption("rtl", "Right to left");
        drop.setValue(this.plugin.settings.boardDirection);
        drop.onChange(async (value) => {
          this.plugin.settings.boardDirection = value === "rtl" ? "rtl" : "ltr";
          await this.plugin.saveSettings();
          this.plugin.refreshTimerViews();
        });
      });

    new Setting(containerEl)
      .setName("Group tasks by project")
      .setDesc(
        "How the Kanban's \"By project\" button groups the cards: a row per project running " +
          "across the status columns, or the tasks of each project kept together inside every column."
      )
      .addDropdown((drop) => {
        drop.addOption("lanes", "A row per project");
        drop.addOption("columns", "Inside each column");
        drop.setValue(this.plugin.settings.projectGrouping);
        drop.onChange(async (value) => {
          this.plugin.settings.projectGrouping = value === "columns" ? "columns" : "lanes";
          await this.plugin.saveSettings();
          this.plugin.refreshTimerViews();
        });
      });

    new Setting(containerEl)
      .setName("Order of projects")
      .setDesc("How the grouped board orders its projects. Pinned projects always come first.")
      .addDropdown((drop) => {
        drop.addOption("activity", "Most recently worked on");
        drop.addOption("priority", "Project priority");
        drop.addOption("open", "Most unfinished tasks");
        drop.addOption("name", "Name");
        drop.setValue(this.plugin.settings.projectOrder);
        drop.onChange(async (value) => {
          this.plugin.settings.projectOrder = value as ProjectOrder;
          await this.plugin.saveSettings();
          this.plugin.refreshTimerViews();
        });
      });

    new Setting(containerEl)
      .setName("Week starts on")
      .setDesc("Default follows the calendar — Saturday for Jalali, Monday for Gregorian.")
      .addDropdown((drop) => {
        drop.addOption("auto", "Default for the calendar");
        drop.addOption("sat", "Saturday");
        drop.addOption("sun", "Sunday");
        drop.addOption("mon", "Monday");
        drop.setValue(this.plugin.settings.weekStart);
        drop.onChange(async (value) => {
          this.plugin.settings.weekStart = value as WeekStart;
          await this.plugin.saveSettings();
          this.plugin.refreshTimerViews();
        });
      });

    // Workspaces
    new Setting(containerEl).setName("Workspaces").setHeading();

    this.plugin.settings.workspaces.forEach((ws, index) => {
      const wsContainer = containerEl.createDiv({ cls: "pm-workspace-setting" });
      new Setting(wsContainer).setName(ws.name).setHeading();

      new Setting(wsContainer)
        .setName("Workspace name")
        .setDesc("Renaming updates every task and project in the workspace to match.")
        .addText((text) => {
          text.setValue(ws.name);
          // Applied when the field is left rather than on every keystroke:
          // each rename rewrites notes, and half-typed names are not wanted
          text.inputEl.addEventListener("change", async () => {
            const target = this.plugin.settings.workspaces[index];
            const name = text.getValue().trim();
            if (!name || name === target.name) {
              text.setValue(target.name);
              return;
            }
            if (this.plugin.settings.workspaces.some((w) => w !== target && w.name === name)) {
              new Notice(`There is already a workspace called "${name}"`);
              text.setValue(target.name);
              return;
            }
            const updated = await this.plugin.workspaceManager.renameWorkspace(target, name);
            await this.plugin.saveSettings();
            this.plugin.refreshTimerViews();
            new Notice(`Workspace renamed — ${updated} note${updated === 1 ? "" : "s"} updated`);
            this.display();
          });
        });

      new Setting(wsContainer)
        .setName("Root folder")
        .addText((text) => this.folderField(text, index, "rootFolder"));

      new Setting(wsContainer)
        .setName("Projects folder")
        .addText((text) => this.folderField(text, index, "projectsFolder"));

      new Setting(wsContainer)
        .setName("Tasks folder")
        .addText((text) => this.folderField(text, index, "tasksFolder"));

      new Setting(wsContainer)
        .setName("Time entries folder")
        .addText((text) => this.folderField(text, index, "timeEntriesFolder"));

      new Setting(wsContainer)
        .setName("Archive folder")
        .setDesc(
          "Tasks and projects that reach a closed status move here with their " +
            "time entries, into Tasks / Projects / TimeEntries subfolders. They stay in " +
            "the board and the reports — only the files move. Leave empty to turn archiving off."
        )
        .addText((text) => {
          text.setPlaceholder(defaultArchiveFolder(ws.rootFolder));
          this.folderField(text, index, "archiveFolder");
        });

      new Setting(wsContainer)
        .setName("Tidy archive now")
        .setDesc("Move everything already closed into the archive, and bring back anything reopened.")
        .addButton((btn) =>
          btn.setButtonText("Tidy archive").onClick(async () => {
            const target = this.plugin.settings.workspaces[index];
            await this.plugin.archiveManager.ensureArchiveFolders(target);
            const r = await this.plugin.archiveManager.syncWorkspace(target);
            new Notice(
              r.moved || r.restored
                ? `${r.moved} moved, ${r.restored} restored`
                : "Already up to date"
            );
          })
        );

      if (this.plugin.settings.workspaces.length > 1) {
        new Setting(wsContainer).addButton((btn) =>
          btn
            .setButtonText("Remove workspace")
            .setWarning()
            .onClick(() => {
              const target = this.plugin.settings.workspaces[index];
              new ConfirmModal(this.app, {
                title: `Remove "${target.name}"?`,
                body:
                  "Only the workspace setting goes. Its folders and every task, project and " +
                  "time entry in them stay in the vault, and adding a workspace with the same " +
                  "name and folders brings them back.",
                confirmText: "Remove",
                onConfirm: async () => {
                  this.plugin.settings.workspaces.splice(index, 1);
                  if (!this.plugin.settings.workspaces.some((w) => w.id === this.plugin.settings.defaultWorkspaceId)) {
                    this.plugin.settings.defaultWorkspaceId = this.plugin.settings.workspaces[0].id;
                  }
                  await this.plugin.saveSettings();
                  this.plugin.refreshTimerViews();
                  this.display();
                },
              }).open();
            })
        );
      }
    });

    new Setting(containerEl).addButton((btn) =>
      btn
        .setButtonText("+ Add workspace")
        .setCta()
        .onClick(async () => {
          const id = `ws_${Date.now()}`;
          const name = "NewWorkspace";
          this.plugin.settings.workspaces.push({
            id,
            name,
            rootFolder: name,
            projectsFolder: `${name}/Projects`,
            tasksFolder: `${name}/Tasks`,
            timeEntriesFolder: `${name}/TimeEntries`,
            archiveFolder: defaultArchiveFolder(name),
          });
          await this.plugin.saveSettings();
          this.display();
        })
    );

    // Statuses
    new Setting(containerEl).setName("Task statuses").setHeading();
    new Setting(containerEl)
      .setName("Statuses")
      .setDesc("Comma-separated list")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.statuses.join(", "))
          .onChange(async (value) => {
            // Stored the way notes are compared: trimmed and in lower case.
            // A capitalised status used to be lowered only at the next
            // reload, and until then its column matched no task at all.
            this.plugin.settings.statuses = [
              ...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
            ];
            await this.plugin.saveSettings();
            this.plugin.refreshTimerViews();
          })
      );

    new Setting(containerEl)
      .setName("Closed statuses")
      .setDesc(
        "Statuses that finish a task or project: it moves to the archive, shows muted, " +
          "and leaves open tasks and overdue. Done always counts."
      )
      .addText((text) =>
        text
          .setValue(this.plugin.settings.closedStatuses.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.closedStatuses = [
              ...new Set(value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)),
            ];
            await this.plugin.saveSettings();
            this.plugin.refreshTimerViews();
          })
      );

    new Setting(containerEl)
      .setName("Rename a status")
      .setDesc("Renames it here and in every task and project note, so nothing is left on the old name.")
      .addButton((btn) =>
        btn.setButtonText("Rename…").onClick(() => {
          new RenameStatusModal(this.app, this.plugin, () => this.display()).open();
        })
      );

    // Priorities
    new Setting(containerEl).setName("Priorities").setHeading();
    new Setting(containerEl)
      .setName("Priorities")
      .setDesc("Comma-separated list")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.priorities.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.priorities = value.split(",").map((s) => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          })
      );

    // Settings of features, each under its own heading
    for (const section of this.plugin.ext.settingsSections) section(containerEl);
  }

  /**
   * A workspace folder field. The path is applied when the field is left,
   * not on every keystroke, and tidied the way Obsidian writes paths; the
   * folder is created at once. Before, a changed folder was only created at
   * the next start-up, so the first task or time entry written to it failed.
   */
  private folderField(
    text: TextComponent,
    index: number,
    key: "rootFolder" | "projectsFolder" | "tasksFolder" | "timeEntriesFolder" | "archiveFolder"
  ): void {
    text.setValue(this.plugin.settings.workspaces[index][key] ?? "");
    text.inputEl.addEventListener("change", async () => {
      const ws = this.plugin.settings.workspaces[index];
      const value = normalizePath(text.getValue().trim());
      // An empty archive folder turns archiving off; the others need a path
      if (!value && key !== "archiveFolder") {
        text.setValue(ws[key]);
        return;
      }
      ws[key] = text.getValue().trim() ? value : "";
      text.setValue(ws[key]);
      await this.plugin.workspaceManager.ensureWorkspace(ws);
      await this.plugin.archiveManager.ensureArchiveFolders(ws);
      await this.plugin.saveSettings();
      this.plugin.refreshTimerViews();
    });
  }
}
