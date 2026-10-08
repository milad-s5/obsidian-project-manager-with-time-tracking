// ╔══════════════════════════════════════════════════════════════════════╗
// ║  What's new                                                          ║
// ║  After an update, says what changed since the version last seen,     ║
// ║  from the changelog built into the plugin. Also a command and a      ║
// ║  button in settings, and a setting to stop it opening by itself.     ║
// ╚══════════════════════════════════════════════════════════════════════╝

import { App, Component, MarkdownRenderer, Modal, Setting } from "obsidian";
import type ProjectManagerPlugin from "../main";
import { ChangelogSection, changelogSections, compareVersions, sectionsSince } from "../utils/Changelog";

/** CHANGELOG.md, put in at build time by esbuild.config.mjs */
declare const __CHANGELOG__: string;

const RELEASES_URL = "https://github.com/milad-s5/obsidian-project-manager-with-time-tracking/releases";

class WhatsNewModal extends Modal {
  private component = new Component();

  constructor(
    app: App,
    private current: string,
    private shown: ChangelogSection[],
    private all: ChangelogSection[],
    /** The version updated from, when known */
    private from = ""
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pm-modal", "pm-whatsnew");
    this.component.load();
    contentEl.createEl("h2", { text: `What's new in Project Manager ${this.current}` });
    if (this.from && this.shown.length > 1) {
      contentEl.createDiv({ cls: "pm-whatsnew-sub", text: `Everything since ${this.from}, newest first.` });
    }
    const body = contentEl.createDiv({ cls: "pm-whatsnew-body" });
    this.renderSections(body, this.shown.length ? this.shown : this.all.slice(0, 1));

    const btns = contentEl.createDiv({ cls: "pm-modal-btns" });
    const shownVersions = new Set(this.shown.map((s) => s.version));
    const earlier = this.all.filter((s) => !shownVersions.has(s.version) && compareVersions(s.version, this.current) < 0);
    if (earlier.length) {
      const more = btns.createEl("button", { cls: "pm-btn pm-btn-secondary", text: "Earlier versions" });
      more.addEventListener("click", () => {
        more.remove();
        this.renderSections(body, earlier);
      });
    }
    btns.createEl("a", { cls: "pm-whatsnew-link", text: "All releases", href: RELEASES_URL });
    btns.createEl("button", { cls: "pm-btn pm-btn-primary", text: "Close" })
      .addEventListener("click", () => this.close());
  }

  private renderSections(parent: HTMLElement, sections: ChangelogSection[]): void {
    for (const section of sections) {
      const box = parent.createDiv({ cls: "pm-whatsnew-version markdown-rendered" });
      box.createEl("h3", { text: section.version });
      // A version's own headings sit one level under its name
      void MarkdownRenderer.render(this.app, section.body.replace(/^### /gm, "#### "), box, "", this.component);
    }
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}

export function setupWhatsNew(plugin: ProjectManagerPlugin): void {
  const current = plugin.manifest.version;
  const sections = () => changelogSections(__CHANGELOG__);
  const open = (shown: ChangelogSection[], from = "") => new WhatsNewModal(plugin.app, current, shown, sections(), from).open();

  plugin.addCommand({
    id: "whats-new",
    name: "What's new",
    callback: () => open(sectionsSince(sections(), "", current)),
  });

  plugin.app.workspace.onLayoutReady(async () => {
    const s = plugin.settings;
    if (plugin.freshInstall) {
      // A new install has nothing to catch up on
      s.lastSeenVersion = current;
      await plugin.savePluginData();
      return;
    }
    if (s.lastSeenVersion && compareVersions(current, s.lastSeenVersion) <= 0) return;
    const from = s.lastSeenVersion;
    const shown = sectionsSince(sections(), from, current);
    s.lastSeenVersion = current;
    await plugin.savePluginData();
    if (s.showWhatsNew && shown.length) open(shown, from);
  });

  plugin.ext.settingsSections.push((el) => {
    new Setting(el).setName("What's new").setHeading();
    new Setting(el)
      .setName("Show what's new after an update")
      .setDesc("Once, the first time Obsidian opens with a new version of the plugin.")
      .addToggle((t) => t.setValue(plugin.settings.showWhatsNew).onChange(async (v) => {
        plugin.settings.showWhatsNew = v;
        await plugin.saveSettings();
      }))
      .addButton((b) => b.setButtonText("Open").onClick(() => open(sectionsSince(sections(), "", current))));
  });
}
