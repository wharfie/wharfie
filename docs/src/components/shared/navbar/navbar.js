import React, { useState } from 'react';
import { css } from 'glamor';
import { PAGE_BG, COLOR_BLUE, COLOR_ORANGE, COLOR_YELLOW } from '../color';
import wharfieJson from '../../../../../package.json';
import documentation from 'assets/documentation.json';
import Search from '../search';

// Top-level container
const layoutStyle = css({
  display: 'flex',
  flexDirection: 'column',
  minHeight: '100vh',
  color: '#fff',
});

// NAVBAR
const navbarStyle = css({
  width: '100%',
  height: '60px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 20px',
  boxSizing: 'border-box',
  borderBottom: `2px solid ${COLOR_BLUE}`,
});

const leftSectionStyle = css({
  display: 'flex',
  alignItems: 'center',
});

const titleStyle = css({
  color: COLOR_ORANGE,
  textDecoration: 'none',
  fontSize: '1.2rem',
  ':hover': {
    opacity: 0.8,
  },
});

// Right side of navbar (search + hamburger)
const navButtonsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
});

const iconButtonStyle = css({
  background: 'none',
  border: 'none',
  color: '#fff',
  fontSize: '1.2rem',
  cursor: 'pointer',
  padding: '5px',
  ':hover': {
    opacity: 0.8,
  },
});

// Only show the hamburger/X on mobile
const hamburgerStyle = css({
  display: 'none',
  '@media(max-width: 1170px)': {
    display: 'block',
  },
});

// BODY WRAPPER: Sidebar + Main in a row
const bodyContainerStyle = css({
  display: 'flex',
  flex: 1,
  flexDirection: 'row',
  position: 'relative',
});

// SIDEBAR
/**
 * Use transform+opacity+visibility for a smooth slide/fade effect.
 * On desktop, it’s static. On mobile, it slides in/out.
 */
const sidebarBaseStyle = css({
  width: '250px',
  backgroundColor: PAGE_BG,
  borderRight: `1px solid ${COLOR_BLUE}`,
  overflowY: 'auto',
  padding: '1rem',
  boxSizing: 'border-box',
  transitionProperty: 'opacity, visibility, transform',
  transitionDuration: '0.2s',
  transitionTimingFunction: 'ease-in-out',

  textAlign: 'left',
  // fontSize: '1rem',
  // lineHeight: '1.5rem',

  // Mobile default: hidden off-screen
  position: 'absolute',
  left: 0,
  height: 'calc(100vh - 60px)',
  transform: 'translateX(-100%)',
  opacity: 0,
  visibility: 'hidden',

  // Desktop: static, always visible
  '@media(min-width: 1170px)': {
    position: 'relative',
    transform: 'none',
    opacity: 1,
    visibility: 'visible',
    height: 'auto',
  },
});

// Slide the sidebar in on mobile
const sidebarOpenStyle = css({
  transform: 'translateX(0)',
  opacity: 1,
  zIndex: 12,
  visibility: 'visible',
});

// Top-level item styles
const topLevelItemStyle = css({
  fontWeight: 'bold',
  fontSize: '1.1rem',
  paddingTop: '0.5rem',
  paddingBottom: '0.5rem',
});
const italicItemStyle = css({
  fontStyle: 'italic',
});
const subItemStyle = css({
  fontWeight: 'normal',
  marginLeft: '1.5rem',
  marginBottom: '0.25rem',
});

const linkStyle = css({
  color: COLOR_YELLOW,
  textDecoration: 'none',
  ':hover': {
    textDecoration: 'underline',
  },
});

// MAIN CONTENT
const mainContentStyle = css({
  flex: 1,
  padding: '1rem',
  width: '100%',
});

// OVERLAY behind the sidebar on mobile
const overlayBaseStyle = css({
  position: 'fixed',
  top: '60px',
  left: 0,
  width: '100%',
  height: 'calc(100vh - 60px)',
  backgroundColor: 'rgba(0,0,0,0.7)',
  zIndex: 10,
  transition: 'opacity 0.2s ease-in-out, visibility 0.2s ease-in-out',
  '@media(min-width: 1170px)': {
    display: 'none', // no overlay on desktop
  },
});
const overlayOpenStyle = css({
  opacity: 1,
  visibility: 'visible',
});
const overlayClosedStyle = css({
  opacity: 0,
  visibility: 'hidden',
});

export default function NavBar({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Toggle the sidebar on mobile
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  // Close the sidebar if user taps outside of it
  const onOverlayClick = () => {
    if (sidebarOpen) setSidebarOpen(false);
  };

  // Hamburger → "X" icon
  const menuIcon = sidebarOpen ? '✕' : '☰';

  return (
    <div {...layoutStyle}>
      {/* NAVBAR */}
      <header {...navbarStyle}>
        <div {...leftSectionStyle}>
          <span>{'>'}&nbsp;</span>
          <a href="/" {...titleStyle}>
            Wharfie Documentation (v{wharfieJson.version})
          </a>
        </div>

        <div {...navButtonsStyle}>
          {/* Search icon */}
          <button
            {...iconButtonStyle}
            onClick={() => setSearchOpen(true)}
            aria-label="Open Search"
          >
            🔎
          </button>

          {/* Hamburger / X (mobile only) */}
          <button
            {...iconButtonStyle}
            {...hamburgerStyle}
            onClick={toggleSidebar}
            aria-label="Toggle Sidebar"
          >
            {menuIcon}
          </button>
        </div>
      </header>

      {/* BODY: Sidebar + main in a row */}
      <div {...bodyContainerStyle}>
        {/* OVERLAY behind sidebar (mobile) */}
        <div
          {...css(
            overlayBaseStyle,
            sidebarOpen ? overlayOpenStyle : overlayClosedStyle,
          )}
          onClick={onOverlayClick}
        />

        {/* SIDEBAR */}
        <aside
          {...css(sidebarBaseStyle, sidebarOpen ? sidebarOpenStyle : null)}
        >
          {documentation.hierarchy.map((section, idx) => {
            const topStyle = section.isItalic
              ? css(topLevelItemStyle, italicItemStyle)
              : topLevelItemStyle;

            return (
              <div key={idx}>
                <a href={section.path} {...linkStyle}>
                  <div {...topStyle}>{section.label}</div>
                </a>
                {section.children &&
                  section.children.map((child, i) => (
                    <div key={i} {...subItemStyle}>
                      <a href="/#" {...linkStyle}>
                        {child.label}
                      </a>
                    </div>
                  ))}
              </div>
            );
          })}
        </aside>

        {/* MAIN CONTENT */}
        <main {...mainContentStyle}>{children}</main>
      </div>

      {/* SEARCH MODAL (with fade) */}
      {searchOpen && <Search onClose={() => setSearchOpen(false)} />}
    </div>
  );
}
