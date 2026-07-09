import { describe, expect, it } from 'vitest'
import {
  compileManuscript,
  countManuscriptWords,
  stripEditorial,
  stripFrontmatter
} from './manuscript'

describe('stripFrontmatter', () => {
  it('drops a leading YAML block', () => {
    expect(stripFrontmatter('---\ntitle: X\norder: 1\n---\nHello')).toBe('Hello')
  })

  it('tolerates a BOM before the block', () => {
    expect(stripFrontmatter('\uFEFF---\na: 1\n---\nHi')).toBe('Hi')
  })

  it('leaves text without frontmatter untouched', () => {
    expect(stripFrontmatter('Just text')).toBe('Just text')
    // a `---` that is not at the very top is not frontmatter
    expect(stripFrontmatter('Intro\n---\nnot fm')).toBe('Intro\n---\nnot fm')
  })
})

describe('stripEditorial — the strip-on-export contract', () => {
  it('unwraps @{mentions} to their surface text', () => {
    expect(stripEditorial('He saw @{Irene Adler} there.')).toBe(
      'He saw Irene Adler there.'
    )
  })

  it('removes %% notes %% (single- and multi-line)', () => {
    expect(stripEditorial('The plan %% cliche? %% works.')).toBe('The plan  works.')
    expect(stripEditorial('A%%\nlong\nnote\n%%B')).toBe('AB')
  })

  it('removes {>> comments <<} and unwraps {== highlights ==}', () => {
    expect(stripEditorial('{==the harbor==}{>> too much? <<} smelled')).toBe(
      'the harbor smelled'
    )
    expect(stripEditorial('Hi {>> note <<}there')).toBe('Hi there')
    expect(stripEditorial('a {==big==} deal')).toBe('a big deal')
  })

  it('removes inline thread markers', () => {
    expect(stripEditorial('Text <!-- thread:the-case --> more')).toBe('Text  more')
  })

  it('accepts CriticMarkup tracked changes by default', () => {
    expect(stripEditorial('Go{++ now++}.')).toBe('Go now.')
    expect(stripEditorial('Go{-- right--} now.')).toBe('Go now.')
    expect(stripEditorial('It was {~~good~>great~~}.')).toBe('It was great.')
  })

  it('rejects tracked changes when asked', () => {
    expect(stripEditorial('Go{++ now++}.', 'reject')).toBe('Go.')
    expect(stripEditorial('Go{-- right--} now.', 'reject')).toBe('Go right now.')
    expect(stripEditorial('It was {~~good~>great~~}.', 'reject')).toBe('It was good.')
  })

  it('leaves Markdown ~~strikethrough~~ intact (not a CriticMarkup mark)', () => {
    expect(stripEditorial('This ~~word~~ stays')).toBe('This ~~word~~ stays')
  })

  it('collapses the blank lines a removal leaves behind', () => {
    expect(stripEditorial('A\n\n\n\nB')).toBe('A\n\nB')
  })
})

describe('compileManuscript', () => {
  const scenes = [
    { text: '---\norder: 2\n---\nSecond scene @{Holmes}.', title: 'Two' },
    { text: '---\norder: 1\n---\nFirst {>> hi <<}scene.', title: 'One' }
  ]

  it('joins stripped scene bodies in the given order (caller sorts)', () => {
    expect(compileManuscript(scenes)).toBe('Second scene Holmes.\n\nFirst scene.\n')
  })

  it('can prefix each scene with its title heading', () => {
    expect(compileManuscript([scenes[1]], { sceneTitles: true })).toBe(
      '# One\n\nFirst scene.\n'
    )
  })

  it('returns empty string for no scenes', () => {
    expect(compileManuscript([])).toBe('')
  })

  it('counts words on the compiled prose', () => {
    expect(countManuscriptWords(compileManuscript(scenes))).toBe(5)
  })
})
