// Mobile menu toggle
document.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    const menuClose = document.getElementById('mobile-menu-close');
    const menuOverlay = document.getElementById('mobile-menu-overlay');

    if (menuBtn && mobileMenu) {
        menuBtn.addEventListener('click', () => {
            mobileMenu.classList.remove('hidden');
            // Move focus to close button for keyboard/screen reader users
            if (menuClose) menuClose.focus();
        });

        const closeMenu = () => {
            mobileMenu.classList.add('hidden');
            // Return focus to the hamburger button
            menuBtn.focus();
        };

        if (menuClose) menuClose.addEventListener('click', closeMenu);
        if (menuOverlay) menuOverlay.addEventListener('click', closeMenu);

        // Close menu on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !mobileMenu.classList.contains('hidden')) {
                closeMenu();
            }
        });
    }

    // FAQ Accordion
    document.querySelectorAll('.faq-item .faq-question').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item');
            const wasOpen = item.classList.contains('open');

            // Close all
            document.querySelectorAll('.faq-item').forEach(i => {
                i.classList.remove('open');
                const q = i.querySelector('.faq-question');
                if (q) q.setAttribute('aria-expanded', 'false');
            });

            // Toggle clicked
            if (!wasOpen) {
                item.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });

    // FAQ Search
    const faqSearch = document.getElementById('faq-search');
    const faqNoResults = document.getElementById('faq-no-results');

    if (faqSearch) {
        faqSearch.addEventListener('input', () => {
            const query = faqSearch.value.trim().toLowerCase();
            const items = document.querySelectorAll('.faq-item');
            let visibleCount = 0;

            items.forEach(item => {
                const questionText = item.querySelector('.faq-question span')?.textContent.toLowerCase() || '';
                const answerText = item.querySelector('.faq-answer')?.textContent.toLowerCase() || '';
                const matches = !query || questionText.includes(query) || answerText.includes(query);

                item.style.display = matches ? '' : 'none';
                if (matches) visibleCount++;
            });

            if (faqNoResults) {
                faqNoResults.classList.toggle('hidden', visibleCount > 0);
            }
        });
    }

    // Counter animation on scroll
    const counters = document.querySelectorAll('.counter');
    const statsSection = document.getElementById('stats-section');

    if (counters.length > 0 && statsSection) {
        let hasAnimated = false;

        const animateCounter = (counter) => {
            const target = parseInt(counter.getAttribute('data-target'));
            const shouldFormat = counter.getAttribute('data-format') === 'true';
            const duration = 2000; // 2 seconds
            const steps = 60;
            const stepDuration = duration / steps;
            const increment = target / steps;
            let current = 0;

            const timer = setInterval(() => {
                current += increment;
                if (current >= target) {
                    current = target;
                    clearInterval(timer);
                }

                const displayValue = Math.floor(current);
                if (shouldFormat) {
                    counter.textContent = displayValue.toLocaleString('en-US');
                } else {
                    counter.textContent = displayValue;
                }
            }, stepDuration);
        };

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !hasAnimated) {
                    hasAnimated = true;
                    counters.forEach(counter => {
                        animateCounter(counter);
                    });
                }
            });
        }, { threshold: 0.3 });

        observer.observe(statsSection);
    }
});
