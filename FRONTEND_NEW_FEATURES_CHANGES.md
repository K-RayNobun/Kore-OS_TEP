Here is the explicit breakdown of the changes required on the frontend side, detailing exactly what changes, which components are involved, and how they interact.
1. Feature 1: Writing and Sending a Prompt
This feature changes the app from a "read-only" log viewer to a "write-and-execute" control center.
Parties Involved:
The User (You): Interacts with the interface to type a mission objective.
PromptConsole.tsx (New Component): A clean, text-area input field with a "Launch Mission" button built using React state hooks.
pages/index.tsx (Main Dashboard Wrapper): Hosts the new console component and manages the global application state switching from IDLE to RUNNING.
Fastify Gateway (server.ts / REST API Backend): The endpoint (POST /api/v1/missions/start) that receives the payload from the phone.
How it Works on the Frontend:
The User types a command (e.g., "Scrape the top 50 real estate listings in Douala and output a PDF").
PromptConsole.tsx captures this string in local React state.
When the User clicks "Launch", the component triggers an asynchronous fetch request containing the text string and your security token (X-Kore-Core-Token).
Upon a successful 200 OK response from the Fastify Gateway, pages/index.tsx updates the global app state, automatically clearing the input screen and bringing the TerminalStream foreground to show the live engine thoughts.
2. Feature 2: Rendering Mission Artifacts
When the engine finishes a mission and generates files (like spreadsheets, text files, or PDFs), the phone needs a dedicated, clean space to display, view, and download them.
Parties Involved:
ArtifactsGallery.tsx (New Component): A grid or list-based view component that maps rows from your SQLite mission_artifacts table into clean, clickable UI cards.
DualJournalViewer.tsx (Existing Component): Modified to display a small paperclip icon or "View Artifact" link directly next to the specific task row that generated it.
The Mobile Browser / Native PWA Layer: Handles the actual file saving, rendering, or sharing behavior on your iOS/Android device.
How it Works on the Frontend:
While the mission is running, the PWA listens to the WebSocket. When the engine fires an ARTIFACT_MANIFEST frame, ArtifactsGallery.tsx instantly appends a new card to the UI in real-time.
The User navigates to the Artifacts tab or clicks the link inside the DualJournalViewer.tsx.
If the artifact is an image or a text file, ArtifactsGallery.tsx renders an inline preview. If it's a binary file (like a PDF or zip), clicking it fires a standard download request aimed securely at /api/v1/artifacts/download/:id, allowing you to save it directly to your phone's local storage.
3. Feature 3: Live Human Interventions (CAPTCHAs & Clarifications)
This is the most critical frontend change. The PWA must dynamically morph its UI to demand your immediate attention when the engine gets stuck.
Parties Involved:
InteractiveCanvas.tsx (Existing, but fundamentally upgraded component): Upgraded from a basic iframe container to a dynamic modal/overlay engine that handles multiple event types.
The App UI Layer (pages/index.tsx): Forces a global modal blackout or intercept screen over the entire dashboard when an intervention is requested.
The Native Service Worker (public/sw.js): Intercepts background Web Push alerts if your phone screen is turned off during a roadblock.
How it Works on the Frontend:
The engine hits a CAPTCHA. The gateway pushes an INTERVENTION_REQUEST frame over the WebSocket.
pages/index.tsx intercepts this frame. It immediately freezes the regular UI updates and flashes a high-visibility alert overlay.
InteractiveCanvas.tsx activates and checks the payload type:
If it's a CAPTCHA: It renders a secure, sandbox-isolated <iframe> pointing directly to the live browser viewport stream being hosted on the server, allowing you to solve it by tapping directly on your phone screen.
If it's a Clarification Question: It drops the iframe and instead renders a text prompt (e.g., "Engine found 3 identical download links. Which one should I select?") alongside a set of choice buttons.
Once the User solves the CAPTCHA or clicks a choice, InteractiveCanvas.tsx fires a POST /api/v1/jobs/resume containing the solution data back to the gateway.
The gateway tells the frontend the engine has resumed; pages/index.tsx hides the blackout screen, and your phone goes back to showing the regular real-time terminal feed.
Combined Frontend UI Mockup Layout
To visualize how these changes fit into your existing layout folder structure, your main layout page will now toggle between these key panels:
┌────────────────────────────────────────────────────────┐
│  [🔋 98%]  KORE OS CONTROL CENTER  [Token Budget: 82%] │
├────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐ │
│ │  Prompt Console (Write Mission Goals Here)         │ │
│ │  > [Type your text prompt here...]                 │ │
│ │                                    [LAUNCH MISSION]│ │
│ └────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────┤
│                                                        │
│  ┌──────────────────────┐    ┌──────────────────────┐  │
│  │  TerminalStream.tsx  │    │  ArtifactsGallery.ts │  │
│  │                      │    │                      │  │
│  │  [Live Log Feed]     │    │  📄 mission_data.pdf │  │
│  │  > Executing task... │    │  📊 scraped_list.csv │  │
│  └──────────────────────┘    └──────────────────────┘  │
│                                                        │
├────────────────────────────────────────────────────────┤
│  ⚠️ ATTENTION OVERLAY (InteractiveCanvas.tsx)          │
│  [ Live CAPTCHA Engine Viewport / Tap to Bypass ]      │
└────────────────────────────────────────────────────────┘
