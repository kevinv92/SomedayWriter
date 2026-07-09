import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Entity, ProjectMeta, TreeNode } from '@shared/types'
import { entityTypeMeta, resolveEntityTypes } from '@shared/entity-types'
import type { ResolvedEntityType } from '@shared/entity-types'
import type { QuickFile } from '../components/QuickInput'
import { AnalysisService } from '../analysis/analysis-service'
import { createEntityProvider } from '../analysis/providers/entity-provider'
import { createFrontmatterProvider } from '../analysis/providers/frontmatter-provider'
import { createSpellProvider } from '../analysis/providers/spell-provider'
import { createLanguageToolProvider } from '../analysis/providers/languagetool-provider'
import { createLspProvider } from '../analysis/providers/lsp-provider'
import { entityAt } from '../lib/mentions'

/** Per-project pin maps keyed by project root — persisted whole so one project's
 * pins never clobber another's. */
type PinMap = Record<string, string[]>

export interface UseProjectOptions {
  /** The open project (null on the welcome screen). */
  project: ProjectMeta | null
  /** Open a file in a tab (from go-to-definition). */
  openFile: (path: string) => void
  setNotice: (msg: string | null) => void
  /** Nudge the disk-based panels to re-read (after an entity/index change). */
  bumpInspector: () => void
}

export interface ProjectApi {
  tree: TreeNode | null
  entities: Entity[]
  /** Built-in entity types with this project's `entityTypes` merged over them. */
  entityTypes: ResolvedEntityType[]
  /** Profile path → type icon name, for tree badges. */
  entityIcons: Map<string, string>
  /** Flat list of the project's `.md` files, for Quick Open. */
  projectFiles: QuickFile[]
  /** The analysis facade the editor talks to (completion, diagnostics). */
  analysis: AnalysisService
  pinnedPaths: string[]
  explorerPins: string[]
  refreshEntities: () => void
  /** Re-read the tree + entities (after a file operation). */
  refreshTree: () => Promise<void>
  /** Re-read only the tree (after adding an asset). */
  reloadTree: () => Promise<void>
  /** Reload from disk: drop the index cache, re-read tree + entities. */
  forceRefresh: () => Promise<void>
  togglePin: (path: string) => void
  toggleExplorerPin: (path: string) => void
  goToDefinition: (lineText: string, column: number) => void
  /** Seed the per-project pin maps from persisted settings on first launch. */
  hydratePins: (s: { pins?: PinMap; explorerPins?: PinMap }) => void
  /** On project open: load this project's pins + re-read tree + entities. */
  onOpen: (project: ProjectMeta) => Promise<void>
}

/**
 * The open project's data domain: the file tree, the story index (entities) and
 * the analysis facade fed from it, the registered entity types, and the
 * per-project pin maps. Takes the current `project` as input — the raw project
 * state + open-lifecycle stay in App, since useDocuments (needs `project.root`)
 * and useSettings (needs `project.config.themes`) also consume it and moving it
 * here would form a dependency cycle.
 */
export function useProject(options: UseProjectOptions): ProjectApi {
  const { project, openFile, setNotice, bumpInspector } = options

  const [tree, setTree] = useState<TreeNode | null>(null)
  const [entities, setEntities] = useState<Entity[]>([])
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([])
  const [explorerPins, setExplorerPins] = useState<string[]>([])
  // The whole per-project pin maps (project root → paths), loaded from settings,
  // so persisting one project's pins never clobbers another's.
  const allPinsRef = useRef<PinMap>({})
  const allExplorerPinsRef = useRef<PinMap>({})

  // The analysis facade + its providers (Phase 4). Created once; the editor
  // talks only to this, never to a provider (SPEC seam).
  const entityProvider = useMemo(() => createEntityProvider(), [])
  const frontmatterProvider = useMemo(() => createFrontmatterProvider(), [])
  const analysis = useMemo(() => {
    const service = new AnalysisService()
    service.register(entityProvider.provider)
    service.register(frontmatterProvider.provider)
    service.register(createSpellProvider())
    service.register(createLanguageToolProvider())
    service.register(createLspProvider())
    return service
  }, [entityProvider, frontmatterProvider])
  useEffect(() => () => analysis.dispose(), [analysis])

  // Load story entities (characters, locations, items, …) from StoryIndex;
  // refresh after edits. Feeds the completion provider, references/
  // go-to-definition, and (via the refresh nonce) the disk-based Inspector +
  // Companion scene detection.
  const refreshEntities = useCallback(() => {
    void window.api.storyEntities().then((next) => {
      entityProvider.setEntities(next)
      frontmatterProvider.setEntities(next)
      setEntities(next)
    })
    bumpInspector()
  }, [entityProvider, frontmatterProvider, bumpInspector])

  const refreshTree = useCallback(async () => {
    setTree(await window.api.readTree())
    refreshEntities()
  }, [refreshEntities])

  const reloadTree = useCallback(async () => {
    setTree(await window.api.readTree())
  }, [])

  // Manual "Reload from Disk": drop the main-process index cache, re-read the
  // tree + entities, and nudge the panels to refetch. For changes made outside
  // the app (another editor, a git checkout) that the app can't see.
  const forceRefresh = useCallback(async () => {
    await window.api.refreshIndex()
    setTree(await window.api.readTree())
    refreshEntities()
    setNotice('Reloaded from disk.')
  }, [refreshEntities, setNotice])

  // Registered entity types (Phase 7, M18): built-in defaults with this project's
  // `entityTypes` merged over them. Drives type badges, frontmatter intellisense,
  // and new-file templates — one source of truth for every "what is a location?".
  const entityTypes = useMemo(() => resolveEntityTypes(project?.config), [project])

  // Feed the registry to the frontmatter completer (M19) so `type:`/field
  // suggestions track the open project's schema.
  useEffect(() => {
    frontmatterProvider.setEntityTypes(entityTypes)
  }, [frontmatterProvider, entityTypes])

  // Icon per profile file, so the tree can badge a location vs. an item. Keyed by
  // path off the entity list (only files with a `type:` appear).
  const entityIcons = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of entities)
      map.set(e.path, entityTypeMeta(e.type, entityTypes).iconName)
    return map
  }, [entities, entityTypes])

  // Flat list of the project's .md files for Quick Open (Cmd/Ctrl+P). `rel` is
  // the file's directory relative to the project root ('' at the root), shown as
  // a dimmed hint so the full file name always reads.
  const projectFiles = useMemo<QuickFile[]>(() => {
    const rootLen = project ? project.root.length + 1 : 0
    const out: QuickFile[] = []
    const walk = (node: TreeNode) => {
      if (node.type === 'file') {
        if (node.name.endsWith('.md')) {
          const relPath = node.path.slice(rootLen)
          const slash = relPath.lastIndexOf('/')
          out.push({
            path: node.path,
            name: node.name,
            rel: slash >= 0 ? relPath.slice(0, slash) : ''
          })
        }
      } else node.children?.forEach(walk)
    }
    tree?.children?.forEach(walk)
    return out
  }, [tree, project])

  // Pin/unpin a Companion reference for the current project, persisting the whole
  // per-project map so other projects' pins are preserved.
  const togglePin = useCallback(
    (path: string) => {
      if (!project) return
      const current = allPinsRef.current[project.root] ?? []
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path]
      allPinsRef.current = { ...allPinsRef.current, [project.root]: next }
      setPinnedPaths(next)
      void window.api.updateSettings({ pins: allPinsRef.current })
    },
    [project]
  )

  // Pin/unpin a file to the explorer's quick-access section (per project).
  const toggleExplorerPin = useCallback(
    (path: string) => {
      if (!project) return
      const current = allExplorerPinsRef.current[project.root] ?? []
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path]
      allExplorerPinsRef.current = {
        ...allExplorerPinsRef.current,
        [project.root]: next
      }
      setExplorerPins(next)
      void window.api.updateSettings({ explorerPins: allExplorerPinsRef.current })
    },
    [project]
  )

  // Go-to-definition: resolve the entity under a cursor position (a Cmd/Ctrl+click
  // in the editor, or the palette command reading the cursor) and open its profile.
  const goToDefinition = useCallback(
    (lineText: string, column: number) => {
      const entity = entityAt(lineText, column, entities)
      if (!entity) {
        setNotice('No entity under the cursor.')
        return
      }
      setNotice(null)
      openFile(entity.path)
    },
    [entities, openFile, setNotice]
  )

  const hydratePins = useCallback((s: { pins?: PinMap; explorerPins?: PinMap }) => {
    allPinsRef.current = s.pins ?? {}
    allExplorerPinsRef.current = s.explorerPins ?? {}
  }, [])

  const onOpen = useCallback(
    async (opened: ProjectMeta) => {
      setPinnedPaths(allPinsRef.current[opened.root] ?? [])
      setExplorerPins(allExplorerPinsRef.current[opened.root] ?? [])
      await refreshTree()
    },
    [refreshTree]
  )

  return {
    tree,
    entities,
    entityTypes,
    entityIcons,
    projectFiles,
    analysis,
    pinnedPaths,
    explorerPins,
    refreshEntities,
    refreshTree,
    reloadTree,
    forceRefresh,
    togglePin,
    toggleExplorerPin,
    goToDefinition,
    hydratePins,
    onOpen
  }
}
