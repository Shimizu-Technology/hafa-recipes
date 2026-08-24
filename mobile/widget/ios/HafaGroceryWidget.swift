import SwiftUI
import WidgetKit

struct HafaGroceryWidgetEntry: TimelineEntry {
  let date: Date
  let state: HafaWidgetState
}

struct HafaGroceryWidgetProvider: TimelineProvider {
  func placeholder(in context: Context) -> HafaGroceryWidgetEntry {
    HafaGroceryWidgetEntry(date: Date(), state: previewState)
  }

  func getSnapshot(
    in context: Context,
    completion: @escaping (HafaGroceryWidgetEntry) -> Void
  ) {
    let state = (try? HafaWidgetStore.shared.readState()) ?? previewState
    completion(HafaGroceryWidgetEntry(date: Date(), state: state))
  }

  func getTimeline(
    in context: Context,
    completion: @escaping (Timeline<HafaGroceryWidgetEntry>) -> Void
  ) {
    let cachedState = (try? HafaWidgetStore.shared.readState()) ?? HafaWidgetState()
    if cachedState.shouldUseCachedTimeline() {
      completion(timeline(for: cachedState))
      return
    }

    Task {
      await HafaWidgetSyncClient.shared.refreshSnapshot()
      let state = (try? HafaWidgetStore.shared.readState()) ?? HafaWidgetState()
      completion(timeline(for: state))
    }
  }

  private func timeline(for state: HafaWidgetState) -> Timeline<HafaGroceryWidgetEntry> {
    Timeline(
      entries: [HafaGroceryWidgetEntry(date: Date(), state: state)],
      policy: .after(Date().addingTimeInterval(30 * 60))
    )
  }

  private var previewState: HafaWidgetState {
    let now = ISO8601DateFormatter().string(from: Date())
    let items = [
      HafaWidgetItem(
        id: UUID().uuidString,
        name: "Rice",
        quantity: "1",
        unit: "bag",
        notes: nil,
        checked: false,
        recipeID: nil,
        recipeTitle: nil,
        addedByName: nil,
        createdAt: now,
        updatedAt: now
      ),
      HafaWidgetItem(
        id: UUID().uuidString,
        name: "Coconut milk",
        quantity: "2",
        unit: "cans",
        notes: nil,
        checked: false,
        recipeID: nil,
        recipeTitle: "Chicken kelaguen",
        addedByName: nil,
        createdAt: now,
        updatedAt: now
      ),
    ]
    let snapshot = HafaWidgetSnapshot(
      accountScopeID: "preview",
      list: HafaWidgetList(
        id: "preview",
        name: "Grocery List",
        isShared: true,
        revision: 1,
        createdAt: now,
        updatedAt: now
      ),
      items: items,
      total: items.count,
      unchecked: items.count,
      checked: 0,
      serverTime: now
    )
    return HafaWidgetState(accountScopeID: "preview", snapshot: snapshot)
  }
}

struct HafaGroceryWidget: Widget {
  let kind = HafaWidgetConstants.widgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: HafaGroceryWidgetProvider()) { entry in
      HafaGroceryWidgetView(entry: entry)
        .containerBackground(for: .widget) {
          HafaWidgetBackground()
        }
    }
    .configurationDisplayName("Håfa Grocery List")
    .description("See your grocery list and check off items without opening the app.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private struct HafaGroceryWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.colorSchemeContrast) private var colorSchemeContrast
  @Environment(\.widgetRenderingMode) private var widgetRenderingMode
  let entry: HafaGroceryWidgetEntry

  private var palette: HafaWidgetPalette {
    HafaWidgetPalette(
      colorScheme: colorScheme,
      contrast: colorSchemeContrast,
      renderingMode: widgetRenderingMode
    )
  }

  var body: some View {
    if let snapshot = entry.state.snapshot {
      switch family {
      case .systemSmall:
        smallView(snapshot)
      case .systemLarge:
        listView(snapshot, familyKey: HafaWidgetPaging.largeFamily)
      default:
        listView(snapshot, familyKey: HafaWidgetPaging.mediumFamily)
      }
    } else {
      reconnectView
    }
  }

  private func smallView(_ snapshot: HafaWidgetSnapshot) -> some View {
    Link(destination: URL(string: "hafarecipes://grocery")!) {
      VStack(alignment: .leading, spacing: 8) {
        Image(systemName: "cart.fill")
          .font(.title2.weight(.semibold))
          .foregroundStyle(palette.accent)
          .widgetAccentable()
        Spacer(minLength: 0)
        Text("\(snapshot.unchecked)")
          .font(.system(size: 42, weight: .bold, design: .rounded))
          .foregroundStyle(.primary)
          .contentTransition(.numericText())
        Text(snapshot.unchecked == 1 ? "item left" : "items left")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
        HStack(spacing: 4) {
          Text("Open list")
          Image(systemName: "arrow.up.right")
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(palette.accent)
        .widgetAccentable()
      }
      .privacySensitive()
    }
  }

  private func listView(_ snapshot: HafaWidgetSnapshot, familyKey: String) -> some View {
    let pageSize = HafaWidgetPaging.pageSize(
      for: familyKey,
      accessibilitySize: dynamicTypeSize.isAccessibilitySize
    ) ?? 1
    let page = HafaWidgetPaging.page(
      state: entry.state,
      familyKey: familyKey,
      pageSize: pageSize
    )

    return VStack(alignment: .leading, spacing: 0) {
      header(snapshot)
      Divider().padding(.vertical, 7)

      if page.rows.isEmpty {
        emptyList
      } else {
        VStack(spacing: family == .systemLarge ? 5 : 4) {
          ForEach(page.rows) { row in
            displayRow(
              row,
              listID: snapshot.list.id,
              familyKey: familyKey,
              pageSize: pageSize
            )
          }
        }
        .id("\(familyKey)-\(page.index)-\(entry.state.collapsedSectionKeys ?? [])")
        .transition(.opacity)
        .animation(.easeOut(duration: 0.18), value: page.index)
        .invalidatableContent()
        .layoutPriority(1)
      }

      Spacer(minLength: 5)
      footer(snapshot, page: page, familyKey: familyKey)
    }
    .privacySensitive()
  }

  private func header(_ snapshot: HafaWidgetSnapshot) -> some View {
    HStack(spacing: 8) {
      Image(systemName: snapshot.list.isShared ? "person.2.fill" : "cart.fill")
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(palette.accent)
        .widgetAccentable()
        .frame(width: 26, height: 26)
        .background(palette.sectionSurface, in: Circle())
      VStack(alignment: .leading, spacing: 1) {
        Text(snapshot.list.name)
          .font(.headline)
          .foregroundStyle(.primary)
          .lineLimit(1)
        Text("\(snapshot.unchecked) remaining")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      Link(destination: URL(string: "hafarecipes://grocery?focusAdd=1")!) {
        Image(systemName: "plus")
          .font(.subheadline.weight(.bold))
          .foregroundStyle(palette.prominentControlForeground)
          .widgetAccentable()
          .frame(width: 30, height: 30)
          .background(palette.prominentControlBackground, in: Circle())
          .accessibilityLabel("Add grocery item in Håfa Recipes")
      }
    }
    .fixedSize(horizontal: false, vertical: true)
    .layoutPriority(2)
  }

  @ViewBuilder
  private func displayRow(
    _ row: HafaWidgetDisplayRow,
    listID: String,
    familyKey: String,
    pageSize: Int
  ) -> some View {
    switch row {
    case let .section(section, continuation):
      sectionRow(
        section,
        continuation: continuation,
        listID: listID,
        familyKey: familyKey,
        pageSize: pageSize
      )
    case let .item(_, item):
      itemRow(item, listID: listID)
    }
  }

  private func sectionRow(
    _ section: HafaWidgetSection,
    continuation: Bool,
    listID: String,
    familyKey: String,
    pageSize: Int
  ) -> some View {
    let isCollapsed = Set(entry.state.collapsedSectionKeys ?? []).contains(section.key)
    return Button(
      intent: ToggleGroceryWidgetSectionIntent(
        listID: listID,
        sectionKey: section.key,
        familyKey: familyKey,
        pageSize: pageSize
      )
    ) {
      HStack(spacing: 7) {
        Image(
          systemName: continuation
            ? "arrow.turn.down.right"
            : (section.isOtherItems ? "list.bullet" : "fork.knife")
        )
        .font(.caption.weight(.semibold))
        .foregroundStyle(palette.accent)
        .frame(width: 15)
        .widgetAccentable()
        Text(section.title)
          .font(.caption.weight(.medium))
          .foregroundStyle(.primary)
          .lineLimit(1)
        Spacer(minLength: 4)
        Text("\(section.checkedCount)/\(section.items.count)")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(palette.accent)
          .monospacedDigit()
          .widgetAccentable()
          .padding(.horizontal, 6)
          .padding(.vertical, 2)
          .background(palette.controlSurface, in: Capsule())
        Image(systemName: isCollapsed ? "chevron.down" : "chevron.up")
          .font(.caption2.weight(.bold))
          .foregroundStyle(.secondary)
      }
      .padding(.horizontal, 8)
      .frame(maxWidth: .infinity, minHeight: 27)
      .background(palette.sectionSurface, in: RoundedRectangle(cornerRadius: 8))
      .overlay {
        RoundedRectangle(cornerRadius: 8)
          .stroke(palette.subtleBorder, lineWidth: colorSchemeContrast == .increased ? 1 : 0.5)
      }
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .invalidatableContent()
    .accessibilityLabel(
      "\(isCollapsed ? "Expand" : "Collapse") \(section.title), \(section.checkedCount) of \(section.items.count) checked"
    )
  }

  private func itemRow(_ item: HafaWidgetItem, listID: String) -> some View {
    HStack(spacing: 8) {
      Toggle(
        isOn: item.checked,
        intent: SetGroceryItemCheckedIntent(
          listID: listID,
          itemID: item.id,
          checked: !item.checked
        )
      ) {
        EmptyView()
      }
      .toggleStyle(HafaWidgetChecklistToggleStyle())
      .accessibilityLabel(item.checked ? "Mark \(item.name) unchecked" : "Mark \(item.name) checked")

      Link(destination: editURL(itemID: item.id)) {
        Text(item.displayName)
          .font(.subheadline.weight(.medium))
          .foregroundStyle(item.checked ? Color.secondary : Color.primary)
          .strikethrough(item.checked)
          .lineLimit(1)
          .minimumScaleFactor(0.82)
      }
      .accessibilityLabel("Edit \(item.name) in Håfa Recipes")
      Spacer(minLength: 0)
    }
    .contentTransition(.opacity)
  }

  private var emptyList: some View {
    Link(destination: URL(string: "hafarecipes://grocery?focusAdd=1")!) {
      HStack(spacing: 10) {
        Image(systemName: "checkmark.seal.fill")
          .font(.title2)
          .foregroundStyle(palette.accent)
          .widgetAccentable()
        VStack(alignment: .leading, spacing: 2) {
          Text("All done")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
          Text("Tap to add something")
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        Spacer()
      }
      .padding(.vertical, 8)
    }
  }

  private func footer(
    _ snapshot: HafaWidgetSnapshot,
    page: HafaWidgetSectionPage,
    familyKey: String
  ) -> some View {
    HStack(spacing: 5) {
      if !entry.state.pending.isEmpty {
        ProgressView().controlSize(.mini)
        Text("\(entry.state.pending.count) syncing")
      } else if entry.state.requiresReconnect {
        Image(systemName: "exclamationmark.triangle.fill")
        Text("Open app to reconnect")
      } else if entry.state.lastError != nil {
        Image(systemName: "wifi.exclamationmark")
        Text("Showing saved list")
      } else {
        Image(systemName: "checkmark.icloud.fill")
        Text("Up to date")
      }
      Spacer()

      if page.totalPages > 1 {
        Button(
          intent: ChangeGroceryWidgetPageIntent(
            listID: snapshot.list.id,
            familyKey: familyKey,
            direction: -1,
            pageSize: page.pageSize
          )
        ) {
          Image(systemName: "chevron.left")
            .font(.caption.weight(.bold))
            .widgetAccentable(page.canMovePrevious)
            .frame(width: 28, height: 28)
            .background(
              page.canMovePrevious ? palette.controlSurface : Color.clear,
              in: Circle()
            )
        }
        .buttonStyle(.plain)
        .foregroundStyle(page.canMovePrevious ? palette.accent : Color.secondary)
        .disabled(!page.canMovePrevious)
        .accessibilityLabel("Previous grocery items")

        Text("\(page.index + 1) of \(page.totalPages)")
          .fontWeight(.semibold)
          .monospacedDigit()
          .contentTransition(.numericText())
          .invalidatableContent()

        Button(
          intent: ChangeGroceryWidgetPageIntent(
            listID: snapshot.list.id,
            familyKey: familyKey,
            direction: 1,
            pageSize: page.pageSize
          )
        ) {
          Image(systemName: "chevron.right")
            .font(.caption.weight(.bold))
            .widgetAccentable(page.canMoveNext)
            .frame(width: 28, height: 28)
            .background(
              page.canMoveNext ? palette.controlSurface : Color.clear,
              in: Circle()
            )
        }
        .buttonStyle(.plain)
        .foregroundStyle(page.canMoveNext ? palette.accent : Color.secondary)
        .disabled(!page.canMoveNext)
        .accessibilityLabel("Next grocery items")
      }
    }
    .font(.caption2)
    .foregroundStyle(.secondary)
    .fixedSize(horizontal: false, vertical: true)
    .layoutPriority(2)
  }

  private func editURL(itemID: String) -> URL {
    var components = URLComponents()
    components.scheme = "hafarecipes"
    components.host = "grocery"
    components.queryItems = [URLQueryItem(name: "editItem", value: itemID)]
    return components.url ?? URL(string: "hafarecipes://grocery")!
  }

  private var reconnectView: some View {
    Link(destination: URL(string: "hafarecipes://grocery")!) {
      VStack(alignment: .leading, spacing: 10) {
        Image(systemName: "cart.fill")
          .font(.title2.weight(.semibold))
          .foregroundStyle(palette.accent)
          .widgetAccentable()
        Spacer(minLength: 0)
        Text("Your grocery list, right here")
          .font(.headline)
          .foregroundStyle(.primary)
        Text("Open Håfa Recipes once to connect this widget.")
          .font(.caption)
          .foregroundStyle(.secondary)
        Text("Open app  →")
          .font(.caption.weight(.bold))
          .foregroundStyle(palette.accent)
          .widgetAccentable()
      }
    }
  }
}

private struct HafaWidgetChecklistToggleStyle: ToggleStyle {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.colorSchemeContrast) private var colorSchemeContrast
  @Environment(\.widgetRenderingMode) private var widgetRenderingMode

  private var palette: HafaWidgetPalette {
    HafaWidgetPalette(
      colorScheme: colorScheme,
      contrast: colorSchemeContrast,
      renderingMode: widgetRenderingMode
    )
  }

  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
        .font(.body.weight(.semibold))
        .foregroundStyle(configuration.isOn ? palette.accent : Color.secondary)
        .widgetAccentable(configuration.isOn)
        .frame(width: 28, height: 28)
        .contentTransition(.symbolEffect)
        .animation(.easeOut(duration: 0.15), value: configuration.isOn)
    }
    .buttonStyle(.plain)
    .contentShape(Circle())
  }
}

private struct HafaWidgetBackground: View {
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.colorSchemeContrast) private var colorSchemeContrast
  @Environment(\.widgetRenderingMode) private var widgetRenderingMode

  var body: some View {
    HafaWidgetPalette(
      colorScheme: colorScheme,
      contrast: colorSchemeContrast,
      renderingMode: widgetRenderingMode
    ).background
  }
}
