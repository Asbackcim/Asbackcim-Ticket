(() => {
  function closeAllSelects(except) {
    document.querySelectorAll(".panel-select.is-open").forEach((selectRoot) => {
      if (selectRoot !== except) {
        selectRoot.classList.remove("is-open");
        const trigger = selectRoot.querySelector(".panel-select-trigger");
        if (trigger) {
          trigger.setAttribute("aria-expanded", "false");
        }
      }
    });
  }

  function getEnabledOptions(menu) {
    return [...menu.querySelectorAll(".panel-select-option:not(:disabled)")];
  }

  function focusSiblingOption(menu, direction) {
    const options = getEnabledOptions(menu);
    if (!options.length) {
      return;
    }

    const currentIndex = options.indexOf(document.activeElement);
    const fallbackIndex = options.findIndex((option) => option.classList.contains("is-selected"));
    const startIndex = currentIndex >= 0 ? currentIndex : Math.max(fallbackIndex, 0);
    const nextIndex = (startIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
  }

  function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement) || select.dataset.panelSelectReady === "true") {
      return;
    }

    const options = [...select.options];
    if (!options.length) {
      return;
    }

    select.dataset.panelSelectReady = "true";
    select.classList.add("is-customized");

    const wrapper = document.createElement("div");
    wrapper.className = "panel-select";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "panel-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const value = document.createElement("span");
    value.className = "panel-select-value";

    const caret = document.createElement("span");
    caret.className = "panel-select-caret";
    caret.setAttribute("aria-hidden", "true");

    trigger.append(value, caret);

    const menu = document.createElement("div");
    menu.className = "panel-select-menu";
    menu.setAttribute("role", "listbox");

    const optionButtons = options.map((option, index) => {
      const optionButton = document.createElement("button");
      optionButton.type = "button";
      optionButton.className = "panel-select-option";
      optionButton.textContent = option.textContent.trim();
      optionButton.dataset.value = option.value;
      optionButton.dataset.index = String(index);
      optionButton.setAttribute("role", "option");

      if (option.disabled) {
        optionButton.disabled = true;
      }

      optionButton.addEventListener("click", () => {
        if (option.disabled) {
          return;
        }

        select.selectedIndex = index;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        wrapper.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
      });

      menu.append(optionButton);
      return optionButton;
    });

    function syncFromSelect() {
      const selectedIndex = Math.max(select.selectedIndex, 0);
      const selectedOption = select.options[selectedIndex] || select.options[0];
      const selectedValue = selectedOption ? selectedOption.value : "";

      value.textContent = selectedOption ? selectedOption.textContent.trim() : "Seciniz";
      wrapper.classList.toggle(
        "is-placeholder",
        Boolean(selectedOption && selectedOption.value === "" && selectedIndex === 0),
      );

      optionButtons.forEach((optionButton, index) => {
        const isSelected = index === selectedIndex;
        optionButton.classList.toggle("is-selected", isSelected);
        optionButton.setAttribute("aria-selected", isSelected ? "true" : "false");

        if (optionButton.dataset.value === selectedValue) {
          optionButton.dataset.selectedValue = "true";
        } else {
          delete optionButton.dataset.selectedValue;
        }
      });
    }

    trigger.addEventListener("click", () => {
      const isOpen = wrapper.classList.contains("is-open");
      closeAllSelects(wrapper);
      wrapper.classList.toggle("is-open", !isOpen);
      trigger.setAttribute("aria-expanded", isOpen ? "false" : "true");
    });

    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        closeAllSelects(wrapper);
        wrapper.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        const selectedOption = menu.querySelector(".panel-select-option.is-selected:not(:disabled)");
        const firstOption = menu.querySelector(".panel-select-option:not(:disabled)");
        (selectedOption || firstOption)?.focus();
      }
    });

    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        wrapper.classList.remove("is-open");
        trigger.setAttribute("aria-expanded", "false");
        trigger.focus();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusSiblingOption(menu, 1);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        focusSiblingOption(menu, -1);
      }
    });

    select.addEventListener("change", syncFromSelect);

    if (select.form) {
      select.form.addEventListener("reset", () => {
        window.requestAnimationFrame(syncFromSelect);
      });
    }

    select.insertAdjacentElement("afterend", wrapper);
    wrapper.append(trigger, menu);
    syncFromSelect();
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".panel-select")) {
      closeAllSelects();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllSelects();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("select.form-select").forEach((select) => {
      enhanceSelect(select);
    });
  });
})();
