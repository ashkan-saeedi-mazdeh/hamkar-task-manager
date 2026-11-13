# Hamkar interface

Hamkar is a Persian task desk. It shows what needs the current person's attention and makes
the next step easy to reach, including on a phone. A dashboard count opens the corresponding
queue. In a queue, the row shows the state and the next action. In task detail, current feedback
or the submitted result comes before the description and full history.

The navigation rail uses forest `#18392e`; the workspace uses canvas `#f5f7f2` and white
surfaces. Green `#23634a` marks primary actions and links. The pale green `#e0edb9` marks current
navigation. Blue, gold, rust and green status labels also spell out the state. Flat panels and
row dividers organize work; elevation is reserved for overlays. Use the shared 24-unit outline
icons instead of decorative text glyphs.

Use Vazirmatn for headings, Persian text and numerals, with Tahoma and sans-serif fallbacks.
The local variable font is [Vazirmatn 33.003](https://github.com/rastikerdar/vazirmatn/tree/v33.003)
under the [SIL Open Font License](public/vazirmatn-OFL.txt). It is served from this app, with no
external font requests. Keep task and name text direction isolated when it may mix Persian and
Latin text. Leave enough line height for Persian shapes and allow user-entered text to wrap.

Desktop uses a table when there is room; narrower layouts use the same content and actions in
stacked rows. Secondary filters are disclosed on demand. Keep keyboard focus visible and put it
back on the originating task when returning to a list. Brief motion marks drawer and dialog
opening; reduced motion disables it.
