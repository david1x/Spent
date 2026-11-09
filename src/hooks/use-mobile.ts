import * as React from "react"

// Below this the sidebar is a drawer and the bottom tab bar takes over:
// phones and tablets, where a fixed sidebar leaves too little room.
const MOBILE_BREAKPOINT = 1024
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

// The server snapshot (false) is also used while hydrating, so server and
// client markup match; the desktop sidebar is CSS-hidden below md anyway.
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
