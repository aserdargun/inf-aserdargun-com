import Image from "next/image";
import { MediaCanvas } from "./media-canvas";
interface MediaFrameProps { alt: string; caption: string; date: string; src: string; }
export function MediaFrame({ alt, caption, date, src }: MediaFrameProps) { return <figure className="media-frame"><MediaCanvas className="media-frame__image" variant="thumbnail"><Image alt={alt} fill sizes="(max-width: 767px) 80vw, 25vw" src={src} /></MediaCanvas><figcaption><strong>{caption}</strong><span>{date}</span></figcaption></figure>; }
