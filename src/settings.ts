import { App, PluginSettingTab, Setting, Modal, ButtonComponent, Notice } from "obsidian";
import ProjectManagerPlugin from "./main";
import { DeleteBehaviour, Workspace, DEFAULT_SETTINGS } from "./types";
import { defaultArchiveFolder } from "./utils/WorkspacePaths";
import { CalendarKind, WeekStart } from "./utils/Calendar";

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

    // Date format
    new Setting(containerEl)
      .setName("Date format")
      .setDesc("e.g. YYYY-MM-DD")
      .addText((text) =>
        text
          .setPlaceholder("YYYY-MM-DD")
          .setValue(this.plugin.settings.dateFormat)
          .onChange(async (value) => {
            this.plugin.settings.dateFormat = value;
            await this.plugin.saveSettings();
          })
      );

    // Workspaces
    new Setting(containerEl).setName("Workspaces").setHeading();

    this.plugin.settings.workspaces.forEach((ws, index) => {
      const wsContainer = containerEl.createDiv({ cls: "pm-workspace-setting" });
      new Setting(wsContainer).setName(ws.name).setHeading();

      new Setting(wsContainer)
        .setName("Workspace name")
        .addText((text) =>
          text.setValue(ws.name).onChange(async (value) => {
            this.plugin.settings.workspaces[index].name = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(wsContainer)
        .setName("Root folder")
        .addText((text) =>
          text.setValue(ws.rootFolder).onChange(async (value) => {
            this.plugin.settings.workspaces[index].rootFolder = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(wsContainer)
        .setName("Projects folder")
        .addText((text) =>
          text.setValue(ws.projectsFolder).onChange(async (value) => {
            this.plugin.settings.workspaces[index].projectsFolder = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(wsContainer)
        .setName("Tasks folder")
        .addText((text) =>
          text.setValue(ws.tasksFolder).onChange(async (value) => {
            this.plugin.settings.workspaces[index].tasksFolder = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(wsContainer)
        .setName("Time entries folder")
        .addText((text) =>
          text.setValue(ws.timeEntriesFolder).onChange(async (value) => {
            this.plugin.settings.workspaces[index].timeEntriesFolder = value;
            await this.plugin.saveSettings();
          })
        );

      new Setting(wsContainer)
        .setName("Archive folder")
        .setDesc(
          "Tasks and projects that reach done / cancel / quite move here with their " +
            "time entries, into Tasks / Projects / TimeEntries subfolders. They stay in " +
            "the board and the reports — only the files move. Leave empty to turn archiving off."
        )
        .addText((text) =>
          text
            .setPlaceholder(defaultArchiveFolder(ws.rootFolder))
            .setValue(ws.archiveFolder ?? "")
            .onChange(async (value) => {
              this.plugin.settings.workspaces[index].archiveFolder = value.trim();
              await this.plugin.saveSettings();
            })
        );

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
            .onClick(async () => {
              this.plugin.settings.workspaces.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
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
    new Setting(containerEl).setName("Task Statuses").setHeading();
    new Setting(containerEl)
      .setName("Statuses")
      .setDesc("Comma-separated list")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.statuses.join(", "))
          .onChange(async (value) => {
            this.plugin.settings.statuses = value.split(",").map((s) => s.trim()).filter(Boolean);
            await this.plugin.saveSettings();
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
  }
}
