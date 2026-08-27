// The site root now opens to the public collection; the owner shell is
// reached via `/today/`. Keeping the admin home on a dedicated path means
// anonymous visitors and signed-in owners each have a stable landing URL.
export const routes = {
  home: "/", today: "/today/", library: "/library/", add: "/add/", review: "/review/", surprise: "/surprise/", settings: "/settings/", view: "/view/", login: "/login/",
} as const;
