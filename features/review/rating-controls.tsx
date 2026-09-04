"use client";

import type { ReviewRating } from "@inf/contracts";
import { Button } from "../../components/ui/button";

const ratings: Array<{ label: string; rating: ReviewRating; shortcut: string }> = [
  { label: "Again", rating: "again", shortcut: "1" }, { label: "Hard", rating: "hard", shortcut: "2" }, { label: "Good", rating: "good", shortcut: "3" }, { label: "Easy", rating: "easy", shortcut: "4" },
];

export function RatingControls({ disabled, onRate }: { disabled: boolean; onRate: (rating: ReviewRating) => void }) {
  return <div aria-label="Review ratings" className="rating-controls" data-equal-targets="true">{ratings.map(({ label, rating, shortcut }) => <Button data-rating={rating} disabled={disabled} key={rating} onClick={() => onRate(rating)} variant={rating === "good" ? "primary" : "secondary"}>{label}<kbd aria-label={`${label} shortcut ${shortcut}`}>{shortcut}</kbd></Button>)}</div>;
}

export const ratingFromShortcut = (key: string): ReviewRating | undefined => ratings.find((rating) => rating.shortcut === key)?.rating;
