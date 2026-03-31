self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open('attendance-app').then(function (cache) {
            return cache.addAll([
                'index.html',
                'style.css',
                'script.js'
            ]);
        })
    );
});