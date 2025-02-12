import React, { useState, useEffect, useRef } from 'react';
import { css } from 'glamor';
import { PAGE_BG, COLOR_BLUE, COLOR_WHITE } from '../color';
import SearchEngine from './engine';
import staticSearchIndex from 'assets/search-index.json';

const modalOverlayBaseStyle = css({
  position: 'fixed',
  top: 0,
  left: 0,
  width: '100%',
  height: '100vh',
  backgroundColor: 'rgba(0,0,0,0.7)',
  zIndex: 9999,
  transition: 'opacity 0.2s ease-in-out, visibility 0.2s ease-in-out',
});

const modalOverlayOpenStyle = css({
  opacity: 1,
  visibility: 'visible',
});

const modalContentStyle = css({
  backgroundColor: PAGE_BG,
  padding: '2rem',
  border: `1px solid ${COLOR_BLUE}`,
  width: '90%',
  maxWidth: '500px',
  boxSizing: 'border-box',
  position: 'relative',
  marginTop: '20vh',
  marginRight: 'auto',
  marginLeft: 'auto',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '75vh',
  overflow: 'hidden',
});

const closeModalButtonStyle = css({
  position: 'absolute',
  top: '0.5rem',
  right: '0.5rem',
  background: 'none',
  border: 'none',
  color: '#fff',
  fontSize: '1.5rem',
  cursor: 'pointer',
  ':hover': {
    opacity: 0.8,
  },
});

const searchBarStyle = css({
  width: '100%',
  padding: '0.5rem',
  border: 'none',
  marginBottom: '1rem',
});

const resultListStyle = css({
  listStyle: 'none',
  padding: 0,
  margin: 0,
});

const resultItemStyle = css({
  transition: 'background-color 0.1s ease',
  ':hover': {
    backgroundColor: 'rgba(50, 50, 50, 0.1)',
  },
  textAlign: 'left',
  margin: 0,
});

const resultLinkStyle = css({
  display: 'block',
  width: '100%',
  color: COLOR_BLUE,
  textDecoration: 'none',
  fontWeight: 'bold',
  paddingTop: '0.8rem',
  paddingBottom: '0.8rem',
  borderRadius: '4px',
  ':hover': {
    textDecoration: 'underline',
  },
});

const resultURLSpanStyle = css({
  color: COLOR_WHITE,
  fontSize: '0.8rem',
  marginTop: '0.2rem',
});

export default function Search({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [engine, setEngine] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    SearchEngine.load(staticSearchIndex)
      .then((eng) => setEngine(eng))
      .catch((err) => console.error('Error loading search index:', err));
  }, []);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const handleInputChange = (e) => {
    setQuery(e.target.value);
  };

  useEffect(() => {
    if (query.trim() === '') {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    const debounceTimeout = setTimeout(() => {
      if (engine) {
        const searchResults = engine.search(query);
        setResults(searchResults);
      } else {
        setResults([]);
      }
      setIsSearching(false);
    }, 200);

    return () => clearTimeout(debounceTimeout);
  }, [query, engine]);

  const onModalOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      {...css(modalOverlayBaseStyle, modalOverlayOpenStyle)}
      onClick={onModalOverlayClick}
    >
      <div {...modalContentStyle} onClick={(e) => e.stopPropagation()}>
        <button {...closeModalButtonStyle} onClick={onClose}>
          ✕
        </button>
        <h2>Search</h2>
        <input
          type="text"
          placeholder="Type to search..."
          value={query}
          onChange={handleInputChange}
          ref={searchInputRef}
          {...searchBarStyle}
        />
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!isSearching && results.length === 0 && query.trim() !== '' && (
            <div
              style={{
                padding: '1rem',
                textAlign: 'center',
                color: COLOR_BLUE,
              }}
            >
              No results found.
            </div>
          )}
          {!isSearching && results.length > 0 && (
            <ul {...resultListStyle}>
              {results.map((result) => (
                <li key={result.docId} {...resultItemStyle}>
                  <a href={result.url} {...resultLinkStyle} onClick={onClose}>
                    {result.title}{' '}
                    <span {...resultURLSpanStyle}>({result.url})</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
