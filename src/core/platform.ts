interface UADataLike {
  platform?: string
}

/**
 * OS detection used only for backend-specific renderer policy. UA-CH is the
 * authoritative Chromium path; the UA fallback keeps local/dev Chromium
 * builds useful when userAgentData is unavailable.
 */
export function isWindowsPlatform(nav: Navigator = navigator): boolean {
  const uaData = (nav as Navigator & { userAgentData?: UADataLike }).userAgentData
  if (uaData?.platform) return uaData.platform === 'Windows'
  return /Windows NT/i.test(nav.userAgent ?? '')
}
