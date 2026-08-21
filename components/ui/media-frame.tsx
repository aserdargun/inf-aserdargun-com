import Image from "next/image";
interface MediaFrameProps { alt: string; caption: string; date: string; src: string; }
export function MediaFrame({ alt, caption, date, src }: MediaFrameProps) { return <figure className="media-frame"><div className="media-frame__image"><Image alt={alt} fill sizes="(max-width: 767px) 80vw, 25vw" src={src} /></div><figcaption><strong>{caption}</strong><span>{date}</span></figcaption></figure>; }
