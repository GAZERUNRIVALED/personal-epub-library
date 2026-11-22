/**
 * Virtual Scroller ringan untuk merender daftar 6.000+ chapter pada 60fps
 * tanpa membebani DOM browser.
 */

export class VirtualChapterList {
    constructor({ viewportEl, spacerEl, contentEl, rowHeight = 44, onSelect }) {
        this.viewport = viewportEl;
        this.spacer = spacerEl;
        this.content = contentEl;
        this.rowHeight = rowHeight;
        this.onSelect = onSelect;

        this.allItems = [];
        this.filteredItems = [];
        this.activeChapterIndex = 0;

        this.viewport.addEventListener('scroll', () => this.render());
    }

    setItems(chapters, activeIndex = 0) {
        this.allItems = chapters;
        this.filteredItems = chapters;
        this.activeChapterIndex = activeIndex;
        this.updateHeight();
        this.render();
    }

    filter(query) {
        const q = query.trim().toLowerCase();
        if (!q) {
            this.filteredItems = this.allItems;
        } else {
            this.filteredItems = this.allItems.filter(ch =>
                ch.title.toLowerCase().includes(q) || String(ch.index + 1).includes(q)
            );
        }
        this.viewport.scrollTop = 0;
        this.updateHeight();
        this.render();
    }

    setActiveIndex(index, scrollToItem = false) {
        this.activeChapterIndex = index;
        if (scrollToItem) {
            const posInFiltered = this.filteredItems.findIndex(item => item.index === index);
            if (posInFiltered !== -1) {
                this.viewport.scrollTop = Math.max(0, (posInFiltered * this.rowHeight) - (this.viewport.clientHeight / 2));
            }
        }
        this.render();
    }

    updateHeight() {
        this.spacer.style.height = `${this.filteredItems.length * this.rowHeight}px`;
    }

    render() {
        const scrollTop = this.viewport.scrollTop;
        const viewportHeight = this.viewport.clientHeight || 500;
        const buffer = 8;

        const startIdx = Math.max(0, Math.floor(scrollTop / this.rowHeight) - buffer);
        const endIdx = Math.min(
            this.filteredItems.length,
            Math.ceil((scrollTop + viewportHeight) / this.rowHeight) + buffer
        );

        this.content.style.transform = `translateY(${startIdx * this.rowHeight}px)`;

        const fragment = document.createDocumentFragment();
        for (let i = startIdx; i < endIdx; i++) {
            const item = this.filteredItems[i];
            const row = document.createElement('div');
            row.className = 'toc-row' + (item.index === this.activeChapterIndex ? ' active' : '');
            row.textContent = `${item.index + 1}. ${item.title}`;
            row.title = item.title;
            row.addEventListener('click', () => this.onSelect(item.index));
            fragment.appendChild(row);
        }

        this.content.innerHTML = '';
        this.content.appendChild(fragment);
    }
}
