import 'assets/styles/highlight.css';
import 'assets/styles/markdown.css';
import React, { useEffect, useRef } from 'react';
import { css } from 'glamor';
import Navbar from 'components/shared/navbar/';
import Footer from 'components/shared/footer/';
import { Helmet } from 'react-helmet';
import wharfieLogo from 'assets/images/beanie.png?as=webp';

const articleStyle = css({
  width: '100%',
});

const contentStyle = css({
  paddingTop: '3em',
  maxWidth: 890,
  textAlign: 'left',
  margin: '0 auto', // Simplified margin
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start', // Changed from space-evenly to prevent shifting
  position: 'relative', // Added for stable positioning
  padding: '3em 0 2em', // Added consistent padding
  '& > *': {
    // Style for direct children
    margin: '0.5em 0', // Consistent spacing between elements
  },
});
const getMetaTags = (entry) => {
  const metaTags = [
    { itemprop: 'name', content: entry.title },
    { itemprop: 'description', content: entry.description },
    { itemprop: 'image', content: wharfieLogo.src },
    { name: 'description', content: entry.description },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: entry.title },
    { name: 'twitter:description', content: entry.description },
    { name: 'twitter:image:src', content: wharfieLogo.src },
    { name: 'og:title', content: entry.title },
    { name: 'og:type', content: 'website' },
    {
      name: 'og:url',
      content: `https://docs.wharfie.dev/${entry.slug}`,
    },
    { name: 'og:image', content: wharfieLogo.src },
    { name: 'og:description', content: entry.description },
    { name: 'og:site_name', content: 'wharfie' },
    {
      name: 'article:published_time',
      content: new Date(entry.published_at).toLocaleString(),
    },
    {
      name: 'article:modified_time',
      content: new Date(entry.updated_at).toLocaleString(),
    },
  ];

  return metaTags;
};

function Entry({ entry, html }) {
  const contentRef = useRef(null);
  useEffect(() => {
    if (contentRef.current) {
      // Grab all code blocks inside the rendered HTML
      const codeBlocks = contentRef.current.querySelectorAll('pre code');

      codeBlocks.forEach((codeBlock) => {
        // Make a .code-block wrapper so we can position the button
        const parentPre = codeBlock.closest('pre');
        if (!parentPre) return;

        // Ensure the parent pre has a special class
        parentPre.classList.add('code-block');

        // Create our button
        const copyBtn = document.createElement('div');
        copyBtn.className = 'copy-button';
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = clipboardIconSvg();

        // Attach a click event to copy the text
        copyBtn.addEventListener('click', () => {
          const codeText = codeBlock.innerText;
          navigator.clipboard.writeText(codeText);
        });

        // Insert button into the pre block
        parentPre.appendChild(copyBtn);
      });
    }
  }, [html]);

  // Simple helper that returns an SVG clipboard icon:
  function clipboardIconSvg() {
    return `<svg
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      ><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>`;
  }
  console.log(entry);
  console.log(entry.updated_at);

  return (
    <article {...articleStyle}>
      <Helmet meta={getMetaTags(entry)}>
        <title>{entry.title}</title>
        <meta name="description" content={entry.description} />
        <link rel="canonical" href={`https://docs.wharfie.dev/${entry.slug}`} />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'http://schema.org',
            '@type': 'NewsArticle',
            mainEntityOfPage: {
              '@type': 'WebPage',
              '@id': `https://docs.wharfie.dev/${entry.slug}`,
            },
            headline: 'Article headline',
            image: [],
            datePublished: '2015-02-05T08:00:00+08:00',
            dateModified: '2015-02-05T09:20:00+08:00',
            author: {
              '@type': 'Person',
              name: 'Joe Van Drunen',
              logo: {
                '@type': 'ImageObject',
                url: 'https://avatars.githubusercontent.com/u/5943242',
              },
            },
            publisher: {
              '@type': 'Organization',
              name: 'Wharfie',
              logo: {
                '@type': 'ImageObject',
                url: 'https://avatars.githubusercontent.com/u/40440717',
              },
            },
            description: entry.description,
          })}
        </script>
      </Helmet>
      <Navbar>
        <section
          className={'entry-content'}
          {...contentStyle}
          ref={contentRef}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </Navbar>
      <Footer timestamp={entry.updated_at} />
    </article>
  );
}

export default Entry;
