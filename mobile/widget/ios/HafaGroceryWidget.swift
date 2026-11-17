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
    // The widget gallery shows sample items until the app connects a list.
    let shown = context.isPreview && state.snapshot == nil ? previewState : state
    completion(HafaGroceryWidgetEntry(date: Date(), state: shown))
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
    func item(_ name: String, _ quantity: String?, _ unit: String?, recipe: String?) -> HafaWidgetItem {
      HafaWidgetItem(
        id: "preview-\(name)",
        name: name,
        quantity: quantity,
        unit: unit,
        notes: nil,
        checked: false,
        recipeID: nil,
        recipeTitle: recipe,
        addedByName: nil,
        createdAt: now,
        updatedAt: now
      )
    }
    let items = [
      item("Chicken thighs", "2", "lb", recipe: "Chicken kelaguen"),
      item("Lemons", "4", nil, recipe: "Chicken kelaguen"),
      item("Grated coconut", "1", "cup", recipe: "Chicken kelaguen"),
      item("Green onions", "1", "bunch", recipe: "Chicken kelaguen"),
      item("Rice", "1", "bag", recipe: nil),
      item("Eggs", "1", "dozen", recipe: nil),
    ]
    let snapshot = HafaWidgetSnapshot(
      accountScopeID: "preview",
      list: HafaWidgetList(
        id: "preview",
        name: "Grocery List",
        isShared: false,
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
      // Capped outside the view so its @ScaledMetric row heights see the same
      // text size as its text. Inside the body they read the uncapped size and
      // left no room for rows at the largest sizes.
      HafaGroceryWidgetView(entry: entry)
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .containerBackground(for: .widget) {
          HafaWidgetBackground()
        }
    }
    .configurationDisplayName("Grocery List")
    .description("See what's left to buy and check items off without opening the app.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private enum HafaWidgetLinks {
  static let grocery = URL(string: "hafarecipes://grocery")!
  static let addItem = URL(string: "hafarecipes://grocery?focusAdd=1")!
}

private struct HafaGroceryWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.colorSchemeContrast) private var colorSchemeContrast
  @Environment(\.widgetRenderingMode) private var widgetRenderingMode
  @ScaledMetric(relativeTo: .subheadline) private var largeItemHeight: CGFloat = 30
  @ScaledMetric(relativeTo: .subheadline) private var mediumItemHeight: CGFloat = 25
  // Group headers are tap targets, so they get a little more room than a label.
  @ScaledMetric(relativeTo: .footnote) private var sectionHeaderHeight: CGFloat = 28
  @ScaledMetric(relativeTo: .footnote) private var overflowHeight: CGFloat = 24
  let entry: HafaGroceryWidgetEntry

  private var palette: HafaWidgetPalette {
    HafaWidgetPalette(
      colorScheme: colorScheme,
      contrast: colorSchemeContrast,
      renderingMode: widgetRenderingMode
    )
  }

  var body: some View {
    Group {
      if let snapshot = entry.state.snapshot {
        if family == .systemSmall {
          smallView(snapshot)
        } else {
          listView(snapshot)
        }
      } else {
        signedOutView
      }
    }
    .widgetURL(entry.state.snapshot?.items.isEmpty == true ? HafaWidgetLinks.addItem : HafaWidgetLinks.grocery)
  }

  // MARK: Small

  private func smallView(_ snapshot: HafaWidgetSnapshot) -> some View {
    let previewLimit = dynamicTypeSize.isAccessibilitySize ? 1 : 3
    let preview = HafaWidgetListLayout.preview(items: snapshot.items, limit: previewLimit)
    return VStack(alignment: .leading, spacing: 0) {
      Text(snapshot.list.name)
        .font(HafaWidgetFont.semibold(13, relativeTo: .footnote))
        .foregroundStyle(palette.accent)
        .widgetAccentable()
        .lineLimit(1)

      if snapshot.unchecked > 0 {
        Text("\(snapshot.unchecked)")
          .font(HafaWidgetFont.bold(34, relativeTo: .largeTitle))
          .foregroundStyle(palette.text)
          .contentTransition(.numericText())
          .padding(.top, 2)
        Text(snapshot.unchecked == 1 ? "item left" : "items left")
          .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
          .foregroundStyle(palette.secondaryText)
      } else {
        Image(systemName: snapshot.total == 0 ? "cart" : "checkmark.circle.fill")
          .font(.system(size: 30, weight: .semibold))
          .foregroundStyle(snapshot.total == 0 ? palette.secondaryText : palette.accent)
          .widgetAccentable()
          .padding(.top, 8)
          .padding(.bottom, 4)
        Text(snapshot.total == 0 ? "Nothing to buy" : "All done")
          .font(HafaWidgetFont.semibold(15, relativeTo: .subheadline))
          .foregroundStyle(palette.text)
        Text(snapshot.total == 0 ? "Tap to add an item" : "Everything is checked off")
          .font(HafaWidgetFont.medium(12, relativeTo: .caption))
          .foregroundStyle(palette.secondaryText)
          .lineLimit(2)
      }

      Spacer(minLength: 6)

      VStack(alignment: .leading, spacing: 4) {
        ForEach(preview) { item in
          HStack(spacing: 6) {
            Circle()
              .strokeBorder(palette.secondaryText, lineWidth: 1.25)
              .frame(width: 9, height: 9)
            Text(item.name)
              .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
              .foregroundStyle(palette.text)
              .lineLimit(1)
          }
        }
      }
      .privacySensitive()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .accessibilityElement(children: .combine)
  }

  // MARK: Medium and large

  private var isLarge: Bool { family == .systemLarge }

  private var rowMetrics: HafaWidgetRowMetrics {
    HafaWidgetRowMetrics(
      item: Double(isLarge ? largeItemHeight : mediumItemHeight),
      header: Double(sectionHeaderHeight),
      // Medium's header already counts what is left, so its rows use all the
      // space instead of sharing it with a "more" line. Folded groups still
      // show their own counts.
      overflow: isLarge ? Double(overflowHeight) : nil
    )
  }

  private func listView(_ snapshot: HafaWidgetSnapshot) -> some View {
    VStack(alignment: .leading, spacing: isLarge ? 8 : 4) {
      header(snapshot)
      if snapshot.items.isEmpty {
        emptyList
      } else {
        GeometryReader { proxy in
          // Medium groups by recipe too, so a group folded in the app or on
          // a large widget reads the same here.
          let layout = HafaWidgetListLayout.make(
            items: snapshot.items,
            pendingItemIDs: Set(entry.state.pending.map(\.itemID)),
            collapsedKeys: Set(entry.state.currentCollapsedSectionKeys),
            availableHeight: Double(proxy.size.height),
            metrics: rowMetrics,
            showsHeaders: true
          )
          rows(layout, accountScopeID: snapshot.accountScopeID, listID: snapshot.list.id, showsOverflow: isLarge && layout.showsOverflow)
        }
        .privacySensitive()
      }
    }
  }

  private func header(_ snapshot: HafaWidgetSnapshot) -> some View {
    HStack(alignment: .center, spacing: 8) {
      if isLarge {
        VStack(alignment: .leading, spacing: 1) {
          Text(snapshot.list.name)
            .font(HafaWidgetFont.bold(17, relativeTo: .headline))
            .foregroundStyle(palette.text)
            .lineLimit(1)
          statusLine(snapshot)
        }
      } else {
        // Medium keeps the header to one line so four items fit below it.
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(snapshot.list.name)
            .font(HafaWidgetFont.bold(15, relativeTo: .subheadline))
            .foregroundStyle(palette.text)
            .lineLimit(1)
            .layoutPriority(1)
          statusLine(snapshot)
        }
      }
      Spacer(minLength: 4)
      Link(destination: HafaWidgetLinks.addItem) {
        Image(systemName: "plus")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(palette.prominentControlForeground)
          .widgetAccentable()
          .frame(width: 30, height: 30)
          .background(palette.prominentControlBackground, in: Circle())
      }
      .accessibilityLabel("Add an item in Håfa Recipes")
    }
    .fixedSize(horizontal: false, vertical: true)
  }

  /// Counts like the app's grocery subtitle; connection problems take over
  /// only when they change what the user should do.
  @ViewBuilder
  private func statusLine(_ snapshot: HafaWidgetSnapshot) -> some View {
    let state = entry.state
    Group {
      if state.requiresReconnect {
        Label("Open the app to reconnect", systemImage: "exclamationmark.triangle.fill")
          .labelStyle(HafaWidgetInlineLabelStyle())
          .foregroundStyle(palette.warning)
      } else {
        let count = snapshot.unchecked == 0
          ? (snapshot.total == 0 ? "Empty" : "All done")
          : (snapshot.unchecked == 1 ? "1 item left" : "\(snapshot.unchecked) items left")
        let detail = !state.pending.isEmpty
          ? "Syncing"
          : (state.lastError != nil ? "Showing saved list" : nil)
        Text([snapshot.list.isShared ? "Shared" : nil, count, detail].compactMap { $0 }.joined(separator: " · "))
          .foregroundStyle(palette.secondaryText)
          .contentTransition(.numericText())
          .invalidatableContent()
      }
    }
    .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
    .lineLimit(1)
  }

  private func rows(_ layout: HafaWidgetListLayout, accountScopeID: String, listID: String, showsOverflow: Bool) -> some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(Array(layout.rows.enumerated()), id: \.element.id) { index, row in
        switch row {
        case let .header(header):
          sectionHeader(header, accountScopeID: accountScopeID, listID: listID)
        case let .item(item):
          let followsItem: Bool = {
            guard index > 0, case .item = layout.rows[index - 1] else { return false }
            return true
          }()
          itemRow(item, listID: listID, showsSeparator: followsItem)
        }
      }
      if showsOverflow {
        Spacer(minLength: 0)
        Link(destination: HafaWidgetLinks.grocery) {
          HStack(spacing: 4) {
            Text("\(layout.hiddenUncheckedCount) more on your list")
            Image(systemName: "chevron.right")
              .font(.system(size: 11, weight: .bold))
          }
          .font(HafaWidgetFont.semibold(13, relativeTo: .footnote))
          .foregroundStyle(palette.accent)
          .widgetAccentable()
          .frame(height: overflowHeight, alignment: .bottomLeading)
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  /// A recipe header folds or unfolds its items with one tap, like the app.
  @ViewBuilder
  private func sectionHeader(_ header: HafaWidgetGroupHeader, accountScopeID: String, listID: String) -> some View {
    if header.isCollapsible {
      let count = "\(header.remaining) left"
      Button(intent: ToggleGrocerySectionIntent(accountScopeID: accountScopeID, listID: listID, sectionKey: header.key)) {
        sectionHeaderLabel(header, count: count)
      }
      .buttonStyle(.plain)
      .accessibilityLabel("\(header.title), \(count)")
      .accessibilityValue(header.isCollapsed ? "Collapsed" : "Expanded")
      .accessibilityHint(header.isCollapsed ? "Shows these items" : "Hides these items")
    } else {
      sectionHeaderLabel(header, count: nil)
        .accessibilityAddTraits(.isHeader)
    }
  }

  private func sectionHeaderLabel(_ header: HafaWidgetGroupHeader, count: String?) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      // The chevron sits in the checkbox column so titles line up with items.
      Image(systemName: "chevron.down")
        .font(.system(size: 11, weight: .bold))
        .foregroundStyle(palette.secondaryText)
        .rotationEffect(.degrees(header.isCollapsed ? -90 : 0))
        .frame(width: 22)
        .opacity(header.isCollapsible ? 1 : 0)
      Text(header.title)
        .font(HafaWidgetFont.semibold(13, relativeTo: .footnote))
        .foregroundStyle(header.isCollapsible ? palette.text : palette.secondaryText)
        .lineLimit(1)
        .layoutPriority(1)
      Spacer(minLength: 4)
      if let count {
        Text(count)
          .font(HafaWidgetFont.medium(12, relativeTo: .caption))
          .foregroundStyle(palette.secondaryText)
          .lineLimit(1)
          .contentTransition(.numericText())
      }
    }
    .frame(maxWidth: .infinity, minHeight: sectionHeaderHeight, maxHeight: sectionHeaderHeight, alignment: .leading)
    .contentShape(Rectangle())
  }

  private func itemRow(_ item: HafaWidgetItem, listID: String, showsSeparator: Bool) -> some View {
    let height = isLarge ? largeItemHeight : mediumItemHeight
    return Toggle(
      isOn: item.checked,
      intent: SetGroceryItemCheckedIntent(
        listID: listID,
        itemID: item.id,
        checked: !item.checked
      )
    ) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(item.name)
          .font(HafaWidgetFont.medium(15, relativeTo: .subheadline))
          .foregroundStyle(item.checked ? palette.secondaryText : palette.text)
          .lineLimit(1)
          // A drawn line, not Text.strikethrough: WidgetKit drops that
          // attribute from some rows after an interactive reload.
          .overlay {
            if item.checked {
              palette.secondaryText.frame(height: 1)
            }
          }
          .layoutPriority(1)
        Spacer(minLength: 0)
        if let amount = item.amountText {
          Text(amount)
            .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
            .foregroundStyle(palette.secondaryText)
            .lineLimit(1)
        }
      }
    }
    .toggleStyle(HafaWidgetRowToggleStyle(palette: palette, height: height))
    .overlay(alignment: .top) {
      if showsSeparator {
        palette.hairline
          .frame(height: 1)
          .padding(.leading, 30)
      }
    }
    .accessibilityLabel([item.name, item.amountText].compactMap { $0 }.joined(separator: ", "))
  }

  private var emptyList: some View {
    Link(destination: HafaWidgetLinks.addItem) {
      VStack(spacing: 4) {
        Image(systemName: "cart")
          .font(.system(size: isLarge ? 28 : 20, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .padding(.bottom, isLarge ? 6 : 2)
        Text("Your list is empty")
          .font(HafaWidgetFont.semibold(15, relativeTo: .subheadline))
          .foregroundStyle(palette.text)
        Text("Tap + to add an item, or add ingredients from a recipe.")
          .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
          .foregroundStyle(palette.secondaryText)
          .multilineTextAlignment(.center)
          .lineLimit(2)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  // MARK: Signed out

  private var signedOutView: some View {
    let isSmall = family == .systemSmall
    return VStack(alignment: isSmall ? .leading : .center, spacing: 4) {
      Text("Grocery List")
        .font(HafaWidgetFont.semibold(13, relativeTo: .footnote))
        .foregroundStyle(palette.accent)
        .widgetAccentable()
        .frame(maxWidth: .infinity, alignment: .leading)
      Spacer(minLength: 0)
      Image(systemName: "cart")
        .font(.system(size: isSmall ? 24 : 28, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .padding(.bottom, 4)
      Text(isSmall ? "Sign in" : "Your grocery list will show here")
        .font(HafaWidgetFont.semibold(15, relativeTo: .subheadline))
        .foregroundStyle(palette.text)
        .fixedSize(horizontal: false, vertical: true)
      Text(isSmall ? "Open Håfa Recipes to see your list." : "Open Håfa Recipes and sign in.")
        .font(HafaWidgetFont.medium(13, relativeTo: .footnote))
        .foregroundStyle(palette.secondaryText)
        .multilineTextAlignment(isSmall ? .leading : .center)
        .fixedSize(horizontal: false, vertical: true)
      if !isSmall { Spacer(minLength: 0) }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: isSmall ? .topLeading : .top)
    .accessibilityElement(children: .combine)
  }
}

/// The whole row checks an item off: a fingertip anywhere on it counts, which
/// matters one-handed in a store aisle.
private struct HafaWidgetRowToggleStyle: ToggleStyle {
  let palette: HafaWidgetPalette
  let height: CGFloat

  func makeBody(configuration: Configuration) -> some View {
    Button {
      configuration.isOn.toggle()
    } label: {
      HStack(spacing: 8) {
        Image(systemName: configuration.isOn ? "checkmark.circle.fill" : "circle")
          .font(.system(size: 20, weight: configuration.isOn ? .semibold : .regular))
          .foregroundStyle(configuration.isOn ? palette.accent : palette.secondaryText)
          .widgetAccentable(configuration.isOn)
          .frame(width: 22)
          .contentTransition(.symbolEffect(.replace))
        configuration.label
      }
      .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .leading)
      .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
  }
}

private struct HafaWidgetInlineLabelStyle: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon.font(.system(size: 11, weight: .semibold))
      configuration.title
    }
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
