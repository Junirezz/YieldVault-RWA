/**
 * Skip navigation links for keyboard and screen-reader users.
 * Revealed on focus so they stay out of the visual layout until needed.
 */
export default function SkipLinks() {
  return (
    <nav className="skip-links" aria-label="Skip links">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <a className="skip-link" href="#primary-nav">
        Skip to navigation
      </a>
    </nav>
  );
}
