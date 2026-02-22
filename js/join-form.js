document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('join-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const btn = document.getElementById('submit-btn');
        const submitText = document.getElementById('submit-text');
        const errorMsg = document.getElementById('error-message');

        // Reset error
        errorMsg.classList.add('hidden');

        // Basic validation
        const required = form.querySelectorAll('[required]');
        let valid = true;
        required.forEach(field => {
            if (field.type === 'checkbox') {
                if (!field.checked) valid = false;
            } else if (!field.value.trim()) {
                valid = false;
                field.classList.add('border-red-400');
                field.addEventListener('input', () => field.classList.remove('border-red-400'), { once: true });
            }
        });

        if (!valid) {
            errorMsg.textContent = 'אנא מלאו את כל שדות החובה המסומנים ב-*';
            errorMsg.classList.remove('hidden');
            form.querySelector('[required]:not(:valid), [required][value=""]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        // Loading state
        btn.disabled = true;
        submitText.textContent = 'שולח...';

        // Collect form data
        const formData = new FormData(form);
        const data = {};
        formData.forEach((value, key) => {
            if (key === 'rescue_tools') {
                if (!data.rescue_tools) data.rescue_tools = [];
                data.rescue_tools.push(value);
            } else {
                data[key] = value;
            }
        });
        if (!data.rescue_tools) data.rescue_tools = [];

        try {
            const res = await fetch('/api/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await res.json();

            if (res.ok && result.success) {
                document.getElementById('join-form-container').classList.add('hidden');
                const successEl = document.getElementById('success-message');
                successEl.classList.remove('hidden');
                successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else {
                throw new Error(result.message || 'שגיאה');
            }
        } catch (err) {
            errorMsg.textContent = err.message === 'שגיאה' ? 'אירעה שגיאה בשליחת הטופס. אנא נסו שוב.' : err.message;
            errorMsg.classList.remove('hidden');
            btn.disabled = false;
            submitText.textContent = 'שלח/י טופס והצטרף/י למשפחה!';
        }
    });
});
