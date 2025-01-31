const fs = require('fs');
const path = require('path');
const { Feed } = require('feed');

class RSSFeedPlugin {
  constructor(options) {
    // Default options
    this.options = {
      jsonFilePath: './input.json', // Path to the JSON file
      outputFilePath: './rss.xml', // Path to the output RSS file
      feedOptions: {
        title: 'My RSS Feed',
        description: 'This is an RSS feed generated from JSON data',
        id: 'https://example.com',
        link: 'https://example.com',
        language: 'en',
        generator: 'Feed for Node.js',
      },
      ...options, // Override defaults with user-provided options
    };
  }

  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync(
      'RSSFeedPlugin',
      (compilation, callback) => {
        const { jsonFilePath, outputFilePath, feedOptions } = this.options;

        // Read the JSON file
        fs.readFile(
          path.resolve(__dirname, jsonFilePath),
          'utf8',
          (err, data) => {
            if (err) {
              compilation.errors.push(
                new Error(
                  `RSSFeedPlugin: Error reading JSON file - ${err.message}`
                )
              );
              return callback();
            }

            try {
              // Parse the JSON data
              const jsonData = JSON.parse(data);
              // Generate the RSS feed
              const rssFeed = this.generateRSSFeed(jsonData, feedOptions);

              // Write the RSS feed to the output file
              fs.writeFile(
                path.resolve(__dirname, outputFilePath),
                rssFeed,
                'utf8',
                (err) => {
                  if (err) {
                    compilation.errors.push(
                      new Error(
                        `RSSFeedPlugin: Error writing RSS file - ${err.message}`
                      )
                    );
                  }
                  callback();
                }
              );
            } catch (err) {
              compilation.errors.push(
                new Error(
                  `RSSFeedPlugin: Error parsing JSON data - ${err.message}`
                )
              );
              callback();
            }
          }
        );
      }
    );
  }

  // Function to generate RSS feed using the `feed` package
  generateRSSFeed(jsonData, feedOptions) {
    const entries = jsonData.entries;

    // Create a new Feed object
    const feed = new Feed({
      ...feedOptions,
      updated: new Date(), // Set the last build date to now
      feedLinks: {
        self: feedOptions.link + '/rss.xml', // Add atom:link with rel="self"
      },
    });

    // Add each entry as an RSS item
    entries.forEach((entry) => {
      if (!entry.published) {
        return;
      }
      feed.addItem({
        title: entry.title,
        id: `${feedOptions.link}/${entry.slug}`,
        link: `${feedOptions.link}/${entry.slug}`,
        description: entry.description,
        date: new Date(entry.published_at),
      });
    });

    // Generate the RSS feed as XML
    return feed.rss2();
  }
}

module.exports = RSSFeedPlugin;
