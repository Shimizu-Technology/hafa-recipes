import SwiftUI
import WidgetKit

private let brandOrange = Color(red: 0.902, green: 0.373, blue: 0.180)
private let brandGreen = Color(red: 0.063, green: 0.149, blue: 0.102)

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
    Task {
      await HafaWidgetSyncClient.shared.refreshSnapshot()
      let state = (try? HafaWidgetStore.shared.readState()) ?? HafaWidgetState()
      let entry = HafaGroceryWidgetEntry(date: Date(), state: state)
      completion(
        Timeline(
          entries: [entry],
          policy: .after(Date().addingTimeInterval(30 * 60))
        )
      )
    }
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
          Color(uiColor: .systemBackground)
        }
    }
    .configurationDisplayName("Håfa Grocery List")
    .description("See your grocery list and check off items without opening the app.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
  }
}

private struct HafaGroceryWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: HafaGroceryWidgetEntry

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
          .foregroundStyle(brandOrange)
        Spacer(minLength: 0)
        Text("\(snapshot.unchecked)")
          .font(.system(size: 42, weight: .bold, design: .rounded))
          .foregroundStyle(brandGreen)
          .contentTransition(.numericText())
        Text(snapshot.unchecked == 1 ? "item left" : "items left")
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
        HStack(spacing: 4) {
          Text("Open list")
          Image(systemName: "arrow.up.right")
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(brandOrange)
      }
      .privacySensitive()
    }
  }

  private func listView(_ snapshot: HafaWidgetSnapshot, familyKey: String) -> some View {
    let page = HafaWidgetPaging.slice(
      state: entry.state,
      familyKey: familyKey,
      total: snapshot.items.count
    )
    let visibleItems = Array(snapshot.items[page.offset..<page.endOffset])

    return VStack(alignment: .leading, spacing: 0) {
      header(snapshot)
      Divider().padding(.vertical, 7)

      if visibleItems.isEmpty {
        emptyList
      } else {
        VStack(spacing: family == .systemLarge ? 7 : 5) {
          ForEach(visibleItems) { item in
            itemRow(item, listID: snapshot.list.id)
          }
        }
      }

      Spacer(minLength: 5)
      footer(snapshot, page: page, familyKey: familyKey)
    }
    .privacySensitive()
  }

  private func header(_ snapshot: HafaWidgetSnapshot) -> some View {
    HStack(spacing: 8) {
      Image(systemName: snapshot.list.isShared ? "person.2.fill" : "cart.fill")
        .foregroundStyle(brandOrange)
      VStack(alignment: .leading, spacing: 1) {
        Text(snapshot.list.name)
          .font(.headline)
          .foregroundStyle(brandGreen)
          .lineLimit(1)
        Text("\(snapshot.unchecked) remaining")
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
      Spacer(minLength: 4)
      Link(destination: URL(string: "hafarecipes://grocery?focusAdd=1")!) {
        Image(systemName: "plus")
          .font(.subheadline.weight(.bold))
          .foregroundStyle(.white)
          .frame(width: 28, height: 28)
          .background(brandOrange, in: Circle())
          .accessibilityLabel("Add grocery item in Håfa Recipes")
      }
    }
  }

  private func itemRow(_ item: HafaWidgetItem, listID: String) -> some View {
    HStack(spacing: 8) {
      Button(
        intent: SetGroceryItemCheckedIntent(
          listID: listID,
          itemID: item.id,
          checked: !item.checked
        )
      ) {
        Image(systemName: item.checked ? "checkmark.circle.fill" : "circle")
          .font(.body.weight(.semibold))
          .foregroundStyle(item.checked ? brandOrange : Color.secondary)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(item.checked ? "Mark \(item.name) unchecked" : "Mark \(item.name) checked")

      Link(destination: editURL(itemID: item.id)) {
        VStack(alignment: .leading, spacing: 0) {
          Text(item.name)
            .font(.subheadline.weight(.medium))
            .foregroundStyle(item.checked ? Color.secondary : Color.primary)
            .strikethrough(item.checked)
            .lineLimit(1)
          if let detail = item.detail {
            Text(detail)
              .font(.caption2)
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }
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
          .foregroundStyle(brandOrange)
        VStack(alignment: .leading, spacing: 2) {
          Text("All done")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(brandGreen)
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
    page: HafaWidgetPageSlice,
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

      if page.total > page.pageSize {
        Button(
          intent: ChangeGroceryWidgetPageIntent(
            listID: snapshot.list.id,
            familyKey: familyKey,
            direction: -1
          )
        ) {
          Image(systemName: "chevron.left")
            .frame(width: 24, height: 24)
        }
        .buttonStyle(.plain)
        .foregroundStyle(page.canMovePrevious ? brandOrange : Color.secondary)
        .disabled(!page.canMovePrevious)
        .accessibilityLabel("Previous grocery items")

        Text("\(page.offset + 1)–\(page.endOffset) of \(page.total)")
          .fontWeight(.semibold)
          .monospacedDigit()

        Button(
          intent: ChangeGroceryWidgetPageIntent(
            listID: snapshot.list.id,
            familyKey: familyKey,
            direction: 1
          )
        ) {
          Image(systemName: "chevron.right")
            .frame(width: 24, height: 24)
        }
        .buttonStyle(.plain)
        .foregroundStyle(page.canMoveNext ? brandOrange : Color.secondary)
        .disabled(!page.canMoveNext)
        .accessibilityLabel("Next grocery items")
      }
    }
    .font(.caption2)
    .foregroundStyle(.secondary)
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
          .foregroundStyle(brandOrange)
        Spacer(minLength: 0)
        Text("Your grocery list, right here")
          .font(.headline)
          .foregroundStyle(brandGreen)
        Text("Open Håfa Recipes once to connect this widget.")
          .font(.caption)
          .foregroundStyle(.secondary)
        Text("Open app  →")
          .font(.caption.weight(.bold))
          .foregroundStyle(brandOrange)
      }
    }
  }
}
