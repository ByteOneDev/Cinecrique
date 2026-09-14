import CoreGraphics
import Foundation

/// Geometry of the band that drags the window.
///
/// The interface fills the whole window, titlebar included, so AppKit never
/// receives a click on its own titlebar. A transparent band is laid over the
/// top of the web view instead: it must cover the brand lockup, clear the
/// traffic lights on the leading edge, and stop before the search field and the
/// action buttons on the trailing edge.
public enum WindowDragPolicy {
    /// Height of the draggable band. Deliberately the compact height of the
    /// interface top bar so the band never spills onto the row below when the
    /// layout switches to its narrow variant.
    public static let bandHeight: CGFloat = 50

    /// Kept clear for the close, minimise and zoom buttons.
    public static let leadingInset: CGFloat = 76

    /// Kept clear for the search field and the top bar action buttons.
    public static let trailingInset: CGFloat = 430

    /// Below this width the band would be too thin to aim at, so it is dropped
    /// entirely rather than fighting the controls for the same pixels.
    public static let minimumBandWidth: CGFloat = 40

    public static func bandWidth(forWindowWidth width: CGFloat) -> CGFloat {
        guard width.isFinite else { return 0 }
        let available = width - leadingInset - trailingInset
        return available >= minimumBandWidth ? available : 0
    }

    public static func bandRect(forWindowSize size: CGSize) -> CGRect {
        let width = bandWidth(forWindowWidth: size.width)
        guard width > 0, size.height >= bandHeight else { return .zero }
        return CGRect(x: leadingInset, y: 0, width: width, height: bandHeight)
    }

    /// `point` is expressed in the flipped coordinate space of the web view,
    /// where the origin sits at the top-left corner.
    public static func isDragPoint(_ point: CGPoint, inWindowSize size: CGSize) -> Bool {
        let band = bandRect(forWindowSize: size)
        guard !band.isEmpty else { return false }
        return band.contains(point)
    }
}
