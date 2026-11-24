import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import * as L from 'leaflet'
import { X } from 'lucide-react'
import './map-popup.css'

interface Props {
  map: L.Map
  coords: [number, number]
  onClose: () => void
  label: string
  children: ReactNode
}

export default function MapPointPopup({ map, coords: [lat, lon], onClose, label, children }: Props) {
  const [mount] = useState(() => document.createElement('div'))
  useLayoutEffect(() => {
    const popup = L.popup({
      className: 'pl-point-popup', offset: [0, -29], closeButton: false,
      closeOnClick: false, closeOnEscapeKey: false, maxWidth: 350, minWidth: 0,
      autoPanPaddingBottomRight: [12, 20],
    }).setLatLng([lat, lon]).setContent(mount)
    function size() {
      const { x, y } = map.getSize()
      const topPadding = x < 450 ? 80 : 58
      popup.options.autoPanPaddingTopLeft = L.point(12, topPadding)
      mount.style.width = Math.min(340, Math.max(100, x - 36)) + 'px'
      mount.style.setProperty('--pl-popup-height', Math.min(445, Math.max(72, y - topPadding - 74)) + 'px')
    }
    function resize() {
      size()
      popup.update()
    }
    size()
    popup.openOn(map)
    map.on('resize', resize)
    // Images and expanded sections can grow after Leaflet's initial placement.
    const observer = new ResizeObserver(() => {
      if (popup.isOpen()) popup.setLatLng([lat, lon])
    })
    observer.observe(mount)
    mount.querySelector<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
    return () => {
      observer.disconnect()
      map.off('resize', resize)
      popup.remove()
    }
  }, [map, mount, lat, lon])

  useEffect(() => {
    const container = map.getContainer()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose()
      }
    }
    container.addEventListener('keydown', keydown)
    return () => container.removeEventListener('keydown', keydown)
  }, [map, onClose])

  return createPortal(
    <div className="pl-popup-body" role="dialog" aria-label={label} tabIndex={-1}
      onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <button type="button" className="pl-popup-close" onClick={onClose} aria-label="Karten-Popup schließen">
        <X size={18} />
      </button>
      <div className="pl-popup-scroll">{children}</div>
    </div>, mount,
  )
}
