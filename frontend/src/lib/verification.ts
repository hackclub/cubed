// People who haven't finished ID verification (Hack Club Auth) can explore and
// work on drafts, but can't submit, buy or upvote. One message, shown at login
// (the dashboard banner) and whenever they try one of those things.
export const NOT_VERIFIED_MESSAGE =
  "You aren't ID verified! You can still explore the platform, but please verify your identity in Hack Club Auth to submit your project or get prizes.";

export const VERIFY_URL = "https://auth.hackclub.com";

// Svelte context key: DashboardRoom provides it, the popups read it.
export const ID_VERIFIED_CONTEXT = "idVerified";
