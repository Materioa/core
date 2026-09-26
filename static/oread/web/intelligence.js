(function () {
    'use strict';

    let blobCache = new Map();
    let pendingRequests = new Map();
    const DEBUG = false; // Set to true only for debugging
    function findCachedDataForUrl(targetUrl) {
        if (blobCache.has(targetUrl)) {
            return blobCache.get(targetUrl);
        }

        // Pre-compute target URL parts once
        const targetParts = targetUrl.split('/');
        const targetFilename = targetParts[targetParts.length - 1];
        const targetPath3 = targetParts.length >= 3 ? targetParts.slice(-3).join('/') : null;

        // Try different URL variations
        for (let [originalUrl, cachedData] of blobCache) {
            const originalParts = originalUrl.split('/');
            const originalFilename = originalParts[originalParts.length - 1];

            // Compare filename (most reliable and fastest)
            if (targetFilename && originalFilename &&
                targetFilename === originalFilename &&
                targetFilename.includes('.pdf')) {
                return cachedData;
            }

            // Compare last 3 path segments (semester/subject/topic.pdf)
            if (targetPath3 && originalParts.length >= 3) {
                const originalPath3 = originalParts.slice(-3).join('/');
                if (targetPath3 === originalPath3) {
                    return cachedData;
                }
            }
        }

        // Only try URL decoding as last resort (expensive operation)
        try {
            const decodedTarget = decodeURIComponent(targetUrl);
            if (decodedTarget !== targetUrl && blobCache.has(decodedTarget)) {
                return blobCache.get(decodedTarget);
            }
        } catch (e) {
            // URL decode failed, skip
        }

        return null;
    }

    // Message handler for parent window communication
    window.addEventListener('message', function (event) {
        if (event.data.type === 'setupBlobIntercept') {
            // console.log('Setting up blob intercept with cache:', event.data.pdfCache);

            // Request actual blob data from parent for each cached item
            event.data.pdfCache.forEach(item => {
                if (item.blobUrl) {
                    // console.log('Requesting blob data for:', item.originalUrl);
                    window.parent.postMessage({
                        type: 'requestBlobData',
                        originalUrl: item.originalUrl,
                        blobUrl: item.blobUrl
                    }, '*');
                }
            });
        }

        if (event.data.type === 'blobDataResponse') {
            let arrayBuffer;
            if (event.data.arrayBuffer instanceof ArrayBuffer) {
                arrayBuffer = event.data.arrayBuffer;
            } else if (event.data.arrayBuffer && typeof event.data.arrayBuffer.arrayBuffer === 'function') {
                // If it's a Blob, convert to ArrayBuffer
                event.data.arrayBuffer.arrayBuffer().then(buffer => {
                    blobCache.set(event.data.originalUrl, {
                        arrayBuffer: buffer,
                        size: event.data.size,
                        cached: true
                    });
                    // console.log('Blob converted and cached for:', event.data.originalUrl);
                });
                return;
            } else {
                // console.error('❌ Invalid blob data received for:', event.data.originalUrl);
                return;
            }

            // Store the ArrayBuffer data for this URL
            blobCache.set(event.data.originalUrl, {
                arrayBuffer: arrayBuffer,
                size: event.data.size,
                cached: true
            });
            if (pendingRequests.has(event.data.originalUrl)) {
                const callbacks = pendingRequests.get(event.data.originalUrl);
                callbacks.forEach(callback => callback());
                pendingRequests.delete(event.data.originalUrl);
            }
        }

        if (event.data.type === 'overlayMode') {
            if (event.data.mode === 'paper-mode') {
                document.body.classList.toggle('paper-reading', event.data.enable);
            }

            if (event.data.mode === 'night-reading') {
                document.body.classList.toggle('night-reading', event.data.enable);
            }
        }

        if (event.data.type === 'themeMode') {
            // console.log('Applying theme mode. Dark:', event.data.isDark);
            document.body.classList.toggle('dark-theme', event.data.isDark);
        }

        // Handle loadFile message for prewarmed viewer
        // This allows the parent to load a new PDF without reloading the viewer
        if (event.data.type === 'loadFile' && event.data.url) {
            const pdfUrl = event.data.url;

            // Use PDF.js PDFViewerApplication to load the new document
            // This is much faster than reloading the entire iframe
            if (typeof PDFViewerApplication !== 'undefined' && PDFViewerApplication.open) {
                // Wait for PDFViewerApplication to be fully initialized
                const loadPdf = () => {
                    if (PDFViewerApplication.initializedPromise) {
                        PDFViewerApplication.initializedPromise.then(() => {
                            PDFViewerApplication.open({ url: pdfUrl }).then(() => {
                                // Notify parent that PDF is loaded
                                window.parent.postMessage({ type: 'pdfLoaded', url: pdfUrl }, '*');
                            }).catch(error => {
                                console.error('❌ Error loading PDF:', error);
                                window.parent.postMessage({ type: 'pdfError', error: error.message, url: pdfUrl }, '*');
                            });
                        });
                    } else {
                        // Fallback if initializedPromise is not available
                        PDFViewerApplication.open({ url: pdfUrl }).catch(error => {
                            console.error('❌ Error loading PDF:', error);
                        });
                    }
                };

                // Check if PDFViewerApplication is ready
                if (PDFViewerApplication.pdfDocument) {
                    // Close current document first
                    PDFViewerApplication.close().then(loadPdf);
                } else {
                    loadPdf();
                }
            } else {
                // Fallback: reload with URL parameter
                if (DEBUG) console.log('PDFViewerApplication not available, using fallback');
                window.location.href = `/oread/web/viewer.html?file=${encodeURIComponent(pdfUrl)}`;
            }
        }
    });    // Override fetch to intercept PDF requests
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
        let targetUrl = typeof input === 'string' ? input : input.url;

        // Log all fetch requests for debugging
        // console.log('FETCH REQUEST:', targetUrl);

        // Only intercept PDF requests
        if (!targetUrl || !targetUrl.includes('.pdf')) {
            // console.log('Skipping non-PDF request');
            return originalFetch.call(this, input, init);
        }

        // console.log('PDF FETCH INTERCEPTED:', targetUrl);
        // console.log('Current cache has', blobCache.size, 'items');

        // Check if we have cached data for this URL
        const cachedData = findCachedDataForUrl(targetUrl);

        if (cachedData && cachedData.arrayBuffer) {
            // console.log('CACHE HIT! Using cached blob for:', targetUrl);
            // console.log('Serving cached data size:', cachedData.size, 'bytes');

            // Create a new ArrayBuffer to avoid transfer issues
            const responseBuffer = cachedData.arrayBuffer.slice();

            return Promise.resolve(new Response(responseBuffer, {
                status: 200,
                statusText: 'OK',
                headers: {
                    'Content-Type': 'application/pdf',
                    'Content-Length': cachedData.size.toString(),
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'max-age=31536000',
                    'X-Cache-Status': 'HIT'
                }
            }));
        }

        // If we're expecting cached data for this URL but don't have it yet, wait a bit
        const urlKey = Array.from(blobCache.keys()).find(key =>
            key === targetUrl || key.includes(targetUrl.split('/').pop())
        );

        if (urlKey && !blobCache.get(urlKey)?.arrayBuffer) {
            // console.log('⏳ Waiting for blob data to arrive for:', targetUrl);

            // Return a promise that resolves when the data arrives or times out
            return new Promise((resolve) => {
                const maxWaitTime = 2000; // Wait up to 2 seconds
                const checkInterval = 100; // Check every 100ms
                let elapsed = 0;

                const checkForData = () => {
                    const data = findCachedDataForUrl(targetUrl);
                    if (data && data.arrayBuffer) {
                        // console.log('DELAYED CACHE HIT! Data arrived for:', targetUrl);
                        const responseBuffer = data.arrayBuffer.slice();
                        resolve(new Response(responseBuffer, {
                            status: 200,
                            statusText: 'OK',
                            headers: {
                                'Content-Type': 'application/pdf',
                                'Content-Length': data.size.toString(),
                                'Accept-Ranges': 'bytes',
                                'Cache-Control': 'max-age=31536000',
                                'X-Cache-Status': 'DELAYED-HIT'
                            }
                        }));
                        return;
                    }

                    elapsed += checkInterval;
                    if (elapsed < maxWaitTime) {
                        setTimeout(checkForData, checkInterval);
                    } else {
                        // console.log('Timeout waiting for blob data, using network for:', targetUrl);
                        resolve(originalFetch.call(this, input, init));
                    }
                };

                setTimeout(checkForData, checkInterval);
            });
        }
        return originalFetch.call(this, input, init);
    };

    // Override XMLHttpRequest for additional PDF.js compatibility
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        this._url = url;
        this._method = method;
        return originalXHROpen.call(this, method, url, async, user, password);
    }; XMLHttpRequest.prototype.send = function (data) {
        const url = this._url;
        const method = this._method || 'GET';
        if (method.toLowerCase() !== 'get' || !url || !url.includes('.pdf')) {
            return originalXHRSend.call(this, data);
        }
        const cachedData = findCachedDataForUrl(url);

        if (cachedData && cachedData.arrayBuffer) {
            const xhr = this;
            setTimeout(() => {
                try {
                    // Set response properties
                    Object.defineProperty(xhr, 'status', { value: 200, writable: false });
                    Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false });
                    Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
                    Object.defineProperty(xhr, 'response', {
                        value: cachedData.arrayBuffer.slice(),
                        writable: false
                    });
                    Object.defineProperty(xhr, 'responseType', { value: 'arraybuffer', writable: false });

                    // Set response headers
                    const getResponseHeader = function (name) {
                        const headers = {
                            'content-type': 'application/pdf',
                            'content-length': cachedData.size.toString(),
                            'accept-ranges': 'bytes',
                            'cache-control': 'max-age=31536000',
                            'x-cache-status': 'HIT'
                        };
                        return headers[name.toLowerCase()] || null;
                    };
                    xhr.getResponseHeader = getResponseHeader;
                    xhr.getAllResponseHeaders = function () {
                        return 'content-type: application/pdf\r\ncontent-length: ' + cachedData.size + '\r\naccept-ranges: bytes\r\ncache-control: max-age=31536000\r\nx-cache-status: HIT\r\n';
                    };

                    // Trigger events
                    if (xhr.onreadystatechange) {
                        xhr.onreadystatechange();
                    }
                    if (xhr.onload) {
                        xhr.onload();
                    }
                } catch (error) {
                    originalXHRSend.call(xhr, data);
                }
            }, 1);
            return;
        }

        // If we're expecting cached data for this URL but don't have it yet, wait a bit
        const urlKey = Array.from(blobCache.keys()).find(key =>
            key === url || key.includes(url.split('/').pop())
        );

        if (urlKey && !blobCache.get(urlKey)?.arrayBuffer) {
            const xhr = this;
            const maxWaitTime = 2000; // Wait up to 2 seconds
            const checkInterval = 100; // Check every 100ms
            let elapsed = 0;

            const checkForData = () => {
                const data = findCachedDataForUrl(url);
                if (data && data.arrayBuffer) {
                    try {
                        // Set response properties
                        Object.defineProperty(xhr, 'status', { value: 200, writable: false });
                        Object.defineProperty(xhr, 'statusText', { value: 'OK', writable: false });
                        Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
                        Object.defineProperty(xhr, 'response', {
                            value: data.arrayBuffer.slice(),
                            writable: false
                        });
                        Object.defineProperty(xhr, 'responseType', { value: 'arraybuffer', writable: false });

                        // Set response headers
                        const getResponseHeader = function (name) {
                            const headers = {
                                'content-type': 'application/pdf',
                                'content-length': data.size.toString(),
                                'accept-ranges': 'bytes',
                                'cache-control': 'max-age=31536000',
                                'x-cache-status': 'DELAYED-HIT'
                            };
                            return headers[name.toLowerCase()] || null;
                        };
                        xhr.getResponseHeader = getResponseHeader;
                        xhr.getAllResponseHeaders = function () {
                            return 'content-type: application/pdf\r\ncontent-length: ' + data.size + '\r\naccept-ranges: bytes\r\ncache-control: max-age=31536000\r\nx-cache-status: DELAYED-HIT\r\n';
                        };

                        // Trigger events
                        if (xhr.onreadystatechange) {
                            xhr.onreadystatechange();
                        }
                        if (xhr.onload) {
                            xhr.onload();
                        }
                    } catch (error) {
                        // console.error('❌ Error setting up delayed cached XHR response:', error);
                        originalXHRSend.call(xhr, data);
                    }
                    return;
                }

                elapsed += checkInterval;
                if (elapsed < maxWaitTime) {
                    setTimeout(checkForData, checkInterval);
                } else {
                    originalXHRSend.call(xhr, data);
                }
            };

            setTimeout(checkForData, checkInterval);
            return;
        }
        return originalXHRSend.call(this, data);
    };

    // Add a test function to verify cache status
    window.checkBlobCache = function () {
        for (let [url, data] of blobCache) {
            console.log('doc', url, '→', data.size, 'bytes');
        }
    };
})();
