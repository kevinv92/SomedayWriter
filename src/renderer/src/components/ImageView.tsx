import { useState } from 'react'

interface ImageViewProps {
  /** A `writer-asset://` URL for the image. */
  url: string
  /** File name, shown in the caption. */
  name: string
}

/** Read-only viewer for an image file opened from the explorer — the editor
 * surface is replaced by the rendered image (loaded via the writer-asset://
 * protocol) with a filename + natural-dimensions caption. */
export function ImageView({ url, name }: ImageViewProps) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)

  return (
    <div className="imageview">
      {failed ? (
        <div className="imageview__error">Couldn’t load {name}.</div>
      ) : (
        <img
          className="imageview__img"
          src={url}
          alt={name}
          onLoad={(e) =>
            setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
          }
          onError={() => setFailed(true)}
        />
      )}
      <div className="imageview__caption">
        {name}
        {dims ? ` · ${dims.w} × ${dims.h}` : ''}
      </div>
    </div>
  )
}
