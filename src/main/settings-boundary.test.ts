import { describe, it, expect } from 'vitest'
import { redactSettings, rendererSettingsPatch } from './settings-boundary'
import type { AppSettings } from '../shared/types'

describe('rendererSettingsPatch', () => {
  it('passes ordinary preference keys through', () => {
    expect(rendererSettingsPatch({ theme: 'dark', vim: true })).toEqual({
      theme: 'dark',
      vim: true
    })
  })

  it('drops grammar so the renderer cannot set a spawned command or endpoint', () => {
    const patch = {
      theme: 'dark',
      grammar: { enabled: true, url: 'https://evil.example', lsp: { command: ['sh'] } }
    }
    expect(rendererSettingsPatch(patch)).toEqual({ theme: 'dark' })
  })

  it('drops hand-edited userThemes', () => {
    expect(rendererSettingsPatch({ userThemes: [], accent: 'sage' })).toEqual({
      accent: 'sage'
    })
  })

  it('treats non-object input as an empty patch', () => {
    expect(rendererSettingsPatch(null)).toEqual({})
    expect(rendererSettingsPatch('grammar')).toEqual({})
    expect(rendererSettingsPatch([{ grammar: {} }])).toEqual({})
  })
})

describe('redactSettings', () => {
  it('strips apiKey and username but keeps the rest of grammar', () => {
    const s: AppSettings = {
      recentProjects: [],
      grammar: { enabled: true, url: 'https://lt.example', apiKey: 'k', username: 'u' }
    }
    expect(redactSettings(s).grammar).toEqual({
      enabled: true,
      url: 'https://lt.example'
    })
  })

  it('returns settings without secrets unchanged', () => {
    const s: AppSettings = { recentProjects: [], theme: 'light' }
    expect(redactSettings(s)).toBe(s)
  })
})
