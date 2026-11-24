import { Fragment, type ReactNode } from 'react'

function inlineText(text: string) {
  const parts: ReactNode[] = []
  const links = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/gi
  let end = 0
  for (const match of text.matchAll(links)) {
    parts.push(text.slice(end, match.index))
    const href = match[2] ?? match[3].replace(/[.,!?:;]+$/, '')
    const trailing = match[3] ? match[3].slice(href.length) : ''
    parts.push(
      <Fragment key={match.index}>
        <a href={href} target="_blank" rel="noreferrer">
          {match[1] ?? href}
        </a>
        {trailing}
      </Fragment>,
    )
    end = match.index + match[0].length
  }
  parts.push(text.slice(end))
  return parts
}

const heading = /^(#{1,6})\s+(.+)$/
const task = /^(\s*[-*+]\s+)\[([ xX])\]\s+(.*)$/
const bullet = /^\s*[-*+]\s+(.*)$/
const number = /^\s*(\d+)[.)]\s+(.*)$/
const blockStart = (line: string) =>
  !line.trim() || heading.test(line) || bullet.test(line) || number.test(line)

export function toggleTask(body: string, index: number) {
  const lines = body.split('\n')
  lines[index] = lines[index].replace(
    /^(\s*[-*+]\s+)\[([ xX])\]/,
    (_match, prefix, checked) => prefix + (checked === ' ' ? '[x]' : '[ ]'),
  )
  return lines.join('\n')
}

export function NotebookText({
  body,
  toggle,
  busy,
}: {
  body: string
  toggle: (index: number) => void
  busy: boolean
}) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  for (let i = 0; i < lines.length; ) {
    const start = i
    const line = lines[i]
    const title = line.match(heading)
    if (!line.trim()) {
      i++
      continue
    }
    if (title) {
      const Tag = title[1].length === 1 ? 'h3' : title[1].length === 2 ? 'h4' : 'h5'
      blocks.push(<Tag key={i++}>{inlineText(title[2])}</Tag>)
    } else if (bullet.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && bullet.test(lines[i])) {
        const index = i++
        const value = lines[index]
        const check = value.match(task)
        items.push(
          check ? (
            <li key={index} className="nb-task">
              <label>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={check[2] !== ' '}
                  onChange={() => toggle(index)}
                />
                <span>{inlineText(check[3])}</span>
              </label>
            </li>
          ) : (
            <li key={index}>{inlineText(value.match(bullet)![1])}</li>
          ),
        )
      }
      blocks.push(<ul key={start}>{items}</ul>)
    } else if (number.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && number.test(lines[i])) {
        items.push(<li key={i}>{inlineText(lines[i++].match(number)![2])}</li>)
      }
      blocks.push(
        <ol start={Number(line.match(number)![1])} key={start}>
          {items}
        </ol>,
      )
    } else {
      const paragraph = [lines[i++]]
      while (i < lines.length && !blockStart(lines[i])) paragraph.push(lines[i++])
      blocks.push(<p key={start}>{inlineText(paragraph.join('\n'))}</p>)
    }
  }
  return <div className="nb-prose">{blocks}</div>
}
