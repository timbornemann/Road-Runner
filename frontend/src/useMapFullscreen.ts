import { useEffect, useRef, useState } from 'react'

export default function useMapFullscreen(dialogOpen: boolean) {
  const [fullscreen, setFullscreen] = useState(false)
  const active = useRef(false)
  const ownsNative = useRef(false)
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null)
  const dialog = useRef(dialogOpen)
  dialog.current = dialogOpen

  function leave() {
    active.current = false
    setFullscreen(false)
    if (ownsNative.current && document.fullscreenElement === document.documentElement) {
      void document.exitFullscreen().catch(() => {})
    }
    ownsNative.current = false
    if (!dialog.current) fullscreenButtonRef.current?.focus({ preventScroll: true })
  }

  function toggleFullscreen() {
    if (active.current) {
      leave()
      return
    }
    active.current = true
    setFullscreen(true)
    // Keep the map's editors (portals in document.body) in the native fullscreen tree.
    const root = document.documentElement
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      ownsNative.current = true
      void root.requestFullscreen().then(() => {
        if (!active.current && document.fullscreenElement === root) void document.exitFullscreen().catch(() => {})
      }).catch(() => { ownsNative.current = false })
    }
  }

  useEffect(() => {
    if (!fullscreen) return
    const root = document.documentElement
    root.classList.add('pl-map-fullscreen')
    function changed() {
      if (ownsNative.current && document.fullscreenElement !== root) leave()
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !dialog.current && !event.defaultPrevented) leave()
    }
    document.addEventListener('fullscreenchange', changed)
    document.addEventListener('keydown', keydown)
    return () => {
      root.classList.remove('pl-map-fullscreen')
      document.removeEventListener('fullscreenchange', changed)
      document.removeEventListener('keydown', keydown)
      active.current = false
      if (ownsNative.current && document.fullscreenElement === root) void document.exitFullscreen().catch(() => {})
      ownsNative.current = false
    }
  }, [fullscreen])

  return { fullscreen, toggleFullscreen, fullscreenButtonRef }
}
