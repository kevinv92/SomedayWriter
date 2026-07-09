import { useState } from 'react'
import type { ProjectConfig } from '@shared/types'

interface ThemeOption {
  id: string
  name: string
}

interface ProjectSettingsProps {
  config: ProjectConfig
  /** Theme choices for the default-theme dropdown (built-ins + custom). */
  themeOptions: ThemeOption[]
  onSave: (config: ProjectConfig) => void
  onCancel: () => void
}

const FONT_PRESETS = ['serif', 'sans', 'mono'] as const

/** Detect how `editor.font` maps onto the preset dropdown. */
function initFont(font: string | undefined): { preset: string; custom: string } {
  if (!font) return { preset: '', custom: '' }
  if ((FONT_PRESETS as readonly string[]).includes(font))
    return { preset: font, custom: '' }
  return { preset: 'custom', custom: font }
}

/**
 * Project Settings — a controlled form over `project.json` (rather than raw JSON
 * editing): each configurable field gets the right control (dropdown for fixed
 * values, number, checkbox) plus help text. Unknown keys and the complex
 * `themes` / `entityTypes` arrays are preserved untouched on save.
 */
export function ProjectSettings({
  config,
  themeOptions,
  onSave,
  onCancel
}: ProjectSettingsProps) {
  const ed = config.editor ?? {}
  const font0 = initFont(ed.font)

  const [name, setName] = useState(config.project.name)
  const [version, setVersion] = useState(config.project.version ?? '')
  const [theme, setTheme] = useState(config.theme ?? '')
  const [fontPreset, setFontPreset] = useState(font0.preset)
  const [fontCustom, setFontCustom] = useState(font0.custom)
  const [fontSize, setFontSize] = useState(ed.fontSize != null ? String(ed.fontSize) : '')
  const [lineHeight, setLineHeight] = useState(
    ed.lineHeight != null ? String(ed.lineHeight) : ''
  )
  const [measureFull, setMeasureFull] = useState(ed.measure === 'full')
  const [measure, setMeasure] = useState(
    typeof ed.measure === 'number' ? String(ed.measure) : ''
  )
  const [wordWrap, setWordWrap] = useState(ed.wordWrap ?? true)
  const [diagnostics, setDiagnostics] = useState(ed.diagnostics ?? false)
  const [autosave, setAutosave] = useState(ed.autosave ?? false)
  const [defaultExtension, setDefaultExtension] = useState(ed.defaultExtension ?? 'md')
  const [ignore, setIgnore] = useState((config.explorer?.ignore ?? []).join('\n'))

  const [error, setError] = useState<string | null>(null)

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('A project name is required.')
      return
    }
    const num = (s: string): number | undefined => {
      const n = parseFloat(s)
      return Number.isFinite(n) ? n : undefined
    }

    const editor: NonNullable<ProjectConfig['editor']> = {
      wordWrap,
      diagnostics,
      autosave
    }
    if (defaultExtension.trim()) editor.defaultExtension = defaultExtension.trim()
    if (fontPreset === 'custom') {
      if (fontCustom.trim()) editor.font = fontCustom.trim()
    } else if (fontPreset) {
      editor.font = fontPreset as 'serif' | 'sans' | 'mono'
    }
    const fs = num(fontSize)
    if (fs !== undefined) editor.fontSize = fs
    const lh = num(lineHeight)
    if (lh !== undefined) editor.lineHeight = lh
    if (measureFull) editor.measure = 'full'
    else {
      const m = num(measure)
      if (m !== undefined) editor.measure = m
    }

    const ignoreList = ignore
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    // Spread the existing config first so unknown keys + themes/entityTypes survive.
    const next: ProjectConfig = {
      ...config,
      project: {
        ...config.project,
        name: trimmed,
        ...(version.trim() ? { version: version.trim() } : {})
      },
      editor,
      explorer: { ...config.explorer, ignore: ignoreList }
    }
    if (!version.trim()) delete next.project.version
    if (theme) next.theme = theme
    else delete next.theme

    onSave(next)
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div
        className="modal modal--settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      >
        <h2 className="modal__title">Project Settings</h2>
        <div className="settings__scroll">
          <fieldset className="settings__group">
            <legend>Project</legend>
            <label className="settings__field">
              <span className="settings__label">Name</span>
              <input
                className="modal__input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <span className="settings__help">Shown in the sidebar and title bar.</span>
            </label>
            <label className="settings__field">
              <span className="settings__label">Version</span>
              <input
                className="modal__input"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
              <span className="settings__help">Optional, for your own tracking.</span>
            </label>
          </fieldset>

          <fieldset className="settings__group">
            <legend>Appearance</legend>
            <label className="settings__field">
              <span className="settings__label">Default theme</span>
              <select
                className="modal__input"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              >
                <option value="">(follow app setting)</option>
                {themeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <span className="settings__help">
                The look this project opens with. The app-wide picker still wins for your
                session.
              </span>
            </label>
          </fieldset>

          <fieldset className="settings__group">
            <legend>Editor</legend>
            <label className="settings__field">
              <span className="settings__label">Reading font</span>
              <select
                className="modal__input"
                value={fontPreset}
                onChange={(e) => setFontPreset(e.target.value)}
              >
                <option value="">Default (theme)</option>
                <option value="serif">Serif</option>
                <option value="sans">Sans-serif</option>
                <option value="mono">Monospace</option>
                <option value="custom">Custom…</option>
              </select>
              <span className="settings__help">
                The prose typeface. “Custom” takes any installed CSS font-family.
              </span>
            </label>
            {fontPreset === 'custom' && (
              <label className="settings__field">
                <span className="settings__label">Custom font family</span>
                <input
                  className="modal__input"
                  placeholder='e.g. "iA Writer Duo", monospace'
                  value={fontCustom}
                  onChange={(e) => setFontCustom(e.target.value)}
                />
              </label>
            )}
            <label className="settings__field">
              <span className="settings__label">Font size (px)</span>
              <input
                className="modal__input"
                type="number"
                min={8}
                max={48}
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
              />
              <span className="settings__help">Default 16.</span>
            </label>
            <label className="settings__field">
              <span className="settings__label">Line height</span>
              <input
                className="modal__input"
                type="number"
                step={0.1}
                min={1}
                max={3}
                value={lineHeight}
                onChange={(e) => setLineHeight(e.target.value)}
              />
              <span className="settings__help">Unitless multiplier. Default 1.7.</span>
            </label>
            <label className="settings__field">
              <span className="settings__label">Text width (rem)</span>
              <input
                className="modal__input"
                type="number"
                min={20}
                max={120}
                value={measure}
                disabled={measureFull}
                onChange={(e) => setMeasure(e.target.value)}
              />
              <span className="settings__help">The reading measure. Default 46.</span>
            </label>
            <label className="settings__check">
              <input
                type="checkbox"
                checked={measureFull}
                onChange={(e) => setMeasureFull(e.target.checked)}
              />
              <span>Full-width (fill the pane instead of a fixed measure)</span>
            </label>
            <label className="settings__check">
              <input
                type="checkbox"
                checked={wordWrap}
                onChange={(e) => setWordWrap(e.target.checked)}
              />
              <span>Word wrap</span>
            </label>
            <label className="settings__check">
              <input
                type="checkbox"
                checked={diagnostics}
                onChange={(e) => setDiagnostics(e.target.checked)}
              />
              <span>Diagnostics on by default (spelling / grammar squiggles)</span>
            </label>
            <label className="settings__check">
              <input
                type="checkbox"
                checked={autosave}
                onChange={(e) => setAutosave(e.target.checked)}
              />
              <span>Autosave (save a beat after you stop typing)</span>
            </label>
            <label className="settings__field">
              <span className="settings__label">Default new-file extension</span>
              <input
                className="modal__input"
                value={defaultExtension}
                onChange={(e) => setDefaultExtension(e.target.value)}
              />
              <span className="settings__help">
                Used when you create a file without one.
              </span>
            </label>
          </fieldset>

          <fieldset className="settings__group">
            <legend>Explorer</legend>
            <label className="settings__field">
              <span className="settings__label">Ignore</span>
              <textarea
                className="modal__input settings__textarea"
                rows={4}
                value={ignore}
                onChange={(e) => setIgnore(e.target.value)}
              />
              <span className="settings__help">
                One name/glob per line; matching files and folders are hidden from the
                tree (e.g. <code>.git</code>, <code>node_modules</code>).
              </span>
            </label>
          </fieldset>

          <p className="settings__note">
            Custom themes and entity types aren’t edited here — they’re preserved as-is.
            Edit <code>project.json</code> directly for those.
          </p>
        </div>

        {error && <p className="settings__error">{error}</p>}
        <div className="modal__actions">
          <button className="toggle" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal__primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
