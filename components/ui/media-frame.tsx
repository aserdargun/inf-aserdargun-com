import { MediaCanvas } from "./media-canvas";
import { ResilientImage } from "./resilient-image";
interface MediaFrameProps { alt: string; caption: string; date: string; src: string; href: string; }
export function MediaFrame({ alt, caption, date, src, href }: MediaFrameProps) {
  return <a aria-label={`Open ${caption}`} href={href}><figure className="media-frame"><MediaCanvas className="media-frame__image" variant="thumbnail"><ResilientImage alt={alt} decoding="async" fallbackLabel={`${alt} preview unavailable`} fallbackText="Preview unavailable" src={src} /></MediaCanvas><figcaption><strong>{caption}</strong><span>{date}</span></figcaption></figure></a>;
}
