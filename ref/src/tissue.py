from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import cv2
import matplotlib.pyplot as plt
import numpy as np
from cv2.typing import MatLike
from matplotlib.gridspec import GridSpec
from sklearn.cluster import DBSCAN

from .constant import ProcessingParams

plt.style.use("dark_background")


def sort_points_clockwise(points: MatLike) -> MatLike:
    """Sort quadrilateral points in clockwise order starting from closest to origin.

    Args:
        points (MatLike): Input points to be sorted

    Returns:
        MatLike: Sorted points in clockwise order
    """
    int_points = points.astype(int)
    centroid = np.mean(int_points, axis=0)
    vectors = int_points - centroid
    angles = np.arctan2(vectors[:, 1], vectors[:, 0])
    return int_points[np.argsort(angles)]


def rotate_image(
    image: MatLike, angle: float, center: Optional[Tuple[int, int]] = None
) -> MatLike:
    """Rotate image by given angle around specified center point.

    Args:
        image: Input image to rotate
        angle: Rotation angle in degrees (positive values for counter-clockwise rotation)
        center: Optional tuple of (x, y) coordinates for rotation center.
               If None, image center will be used

    Returns:
        Rotated image with same dimensions as input
    """
    if center is None:
        # Use image center as rotation point
        center = (image.shape[1] // 2, image.shape[0] // 2)

    # Get the rotation matrix
    rotation_matrix = cv2.getRotationMatrix2D(center=center, angle=angle, scale=1.0)

    # Apply rotation
    rotated_image = cv2.warpAffine(
        image, rotation_matrix, (image.shape[1], image.shape[0])
    )

    return rotated_image


def align_quadrilateral(
    image: MatLike, hull: MatLike
) -> Tuple[MatLike, MatLike, float]:
    """Align quadrilateral to axis-aligned rectangle and rotate image.

    Args:
        image (MatLike): Input image to be aligned
        hull (MatLike): Convex hull points

    Returns:
        Tuple[MatLike, MatLike, float]: Tuple containing:
            - Rotated image
            - Aligned points of the quadrilateral
            - Side length of the aligned rectangle
    """
    # Convert to NumPy arrays with integer coordinates
    hull_points = sort_points_clockwise(hull.reshape(-1, 2).astype(int))
    origin = hull_points[0].astype(int)  # 保持为NumPy数组 [x, y]

    # Compute rotation angle and side length
    side_vector = hull_points[1] - origin
    side_length = np.linalg.norm(side_vector)
    rotation_angle = np.degrees(np.arctan2(side_vector[1], side_vector[0]))
    # Rotate image using the new function
    rotated_image = rotate_image(
        image, angle=rotation_angle, center=tuple(origin.tolist())
    )

    # Get aligned points using NumPy vector operations
    aligned_points = np.array(
        [
            origin,
            origin + np.array([0, side_length]),
            origin + np.array([side_length, side_length]),
            origin + np.array([side_length, 0]),
        ],
        dtype=int,
    )

    return rotated_image, aligned_points, side_length


def is_active_block(block_pixels: MatLike, threshold: float) -> bool:
    """Determine if a block contains sufficient active pixels.

    Args:
        block_pixels (MatLike): block pixel matrix
        threshold (float): activation threshold

    Returns:
        bool: True if block is active, False otherwise
    """
    active_ratio = np.mean(block_pixels > 135)
    return active_ratio > threshold


def apply_channel_thresholds(
    hsv_image: MatLike,
    hue_thresh: Optional[int] = None,
    sat_thresh: Optional[int] = None,
    value_thresh: Optional[int] = None,
) -> MatLike:
    """Apply HSV channel thresholds to create masked image."""
    mask = np.ones(hsv_image.shape[:2], dtype=np.uint8)

    if hue_thresh is not None:
        mask &= (hsv_image[:, :, 0] <= hue_thresh).astype(np.uint8)
    if sat_thresh is not None:
        mask &= (hsv_image[:, :, 1] >= sat_thresh).astype(np.uint8)
    if value_thresh is not None:
        mask &= (hsv_image[:, :, 2] <= value_thresh).astype(np.uint8)

    return cv2.bitwise_and(hsv_image, hsv_image, mask=mask)


def scale_image(image: MatLike, scale_factor: float) -> MatLike:
    """Scale image with linear interpolation."""
    return cv2.resize(
        image, None, fx=scale_factor, fy=scale_factor, interpolation=cv2.INTER_LINEAR
    )


def calculate_grid_dimensions(
    total_length: float | Tuple[float, float],
    grid_size: Tuple[int, int],
    gap_ratio: float,
) -> Tuple[Tuple[float, float], Tuple[float, float]]:
    """Calculate block size and gap size for grid layout.

    Allows specifying distinct lengths for X and Y axes so rectangular grids
    can be derived from a square hull using a width ratio.
    """
    grid_size_x, grid_size_y = grid_size

    # Support rectangular layouts by accepting a tuple of lengths.
    if isinstance(total_length, tuple):
        total_length_x, total_length_y = total_length
    else:
        total_length_x = total_length_y = total_length

    denominator_x = grid_size_x + (grid_size_x + 1) * gap_ratio
    block_size_x = total_length_x / denominator_x
    gap_size_x = block_size_x * gap_ratio

    denominator_y = grid_size_y + (grid_size_y + 1) * gap_ratio
    block_size_y = total_length_y / denominator_y
    gap_size_y = block_size_y * gap_ratio

    return (block_size_x, block_size_y), (gap_size_x, gap_size_y)


def detect_blocks(
    image: MatLike,
    origin: MatLike,
    block_size: Tuple[float, float],
    gap_size: Tuple[float, float],
    grid_size: Tuple[int, int],
    activation_thresh: float,
) -> MatLike:
    """Detect active blocks in grid pattern."""
    binary_matrix = np.zeros(grid_size, dtype=np.uint8)
    block_size_x, block_size_y = block_size
    gap_size_x, gap_size_y = gap_size
    grid_size_x, grid_size_y = grid_size
    for col in range(grid_size_x):
        for row in range(grid_size_y):
            x_start = origin[0] + (gap_size_x + block_size[0]) * col + gap_size_x
            y_start = origin[1] + (gap_size_y + block_size[1]) * row + gap_size_y

            x_end = x_start + block_size_x
            y_end = y_start + block_size_y

            block = image[int(y_start) : int(y_end), int(x_start) : int(x_end)]
            if is_active_block(block, activation_thresh):
                binary_matrix[col, row] = 1
    return binary_matrix


def denoise_with_dbscan(binary_matrix: MatLike, eps: int, min_samples: int) -> MatLike:
    """Remove noise from binary matrix using DBSCAN clustering."""
    points = np.argwhere(binary_matrix == 1)
    if points.size == 0:
        return binary_matrix

    clusters = DBSCAN(eps=eps, min_samples=min_samples).fit(points)
    cleaned = np.zeros_like(binary_matrix)

    for idx, (x, y) in enumerate(points):
        if clusters.labels_[idx] != -1:
            cleaned[x, y] = 1

    return cleaned


def process_image(
    image: MatLike,
    hull: MatLike,
    processing_mode: str = "raw",
    params: ProcessingParams = ProcessingParams(),
    thresholds: Optional[Dict[str, int]] = None,
    side_x_ratio: float = 1.0,
) -> Tuple[MatLike, MatLike, Dict[str, float | Tuple[float, float]]]:
    """
    Main image processing pipeline for grid pattern analysis.

    Args:
        image: Input BGR image array (H, W, 3)
        hull: Convex hull points defining ROI (4, 1, 2)
        params: Processing parameters configuration
        thresholds: Dictionary of threshold values (keys: hue, saturation, value)

    Returns:
        Tuple containing:
            - preview image of the cropped HSV region converted to BGR
            - cleaned binary matrix (grid_size x grid_size) of detected blocks
            - metadata with side length, gap size, and block size
            - new hull points of the aligned rectangle (4, 1, 2)
    """
    # Image aligned and preprocessing
    rotated_img, aligned_points, base_side_length = align_quadrilateral(image, hull)

    # Derive rectangular dimensions from the square hull using the provided ratio.
    side_length_x = base_side_length * side_x_ratio
    side_length_y = base_side_length
    side_length = min(side_length_x, side_length_y)

    roi_points = np.array(
        [
            aligned_points[0],
            aligned_points[0] + np.array([0, side_length_y]),
            aligned_points[0] + np.array([side_length_x, side_length_y]),
            aligned_points[0] + np.array([side_length_x, 0]),
        ],
        dtype=int,
    )
    # Keep a hull-shaped version for downstream consumers that expect (4, 2)
    rect_hull = roi_points.reshape(4, 2)

    # Init the threshlod params
    thresholds = thresholds or {}
    hue_thresh = thresholds.get("hue")
    sat_thresh = thresholds.get("saturation")
    value_thresh = thresholds.get("value")

    # mode
    if processing_mode == "raw":
        hsv_image = cv2.cvtColor(rotated_img, cv2.COLOR_BGR2HSV)
    elif processing_mode == "gray-max":
        b, g, r = cv2.split(rotated_img)
        max_values = np.maximum(np.maximum(b, g), r)
        decolorized_image = cv2.merge([max_values, max_values, max_values])
        hsv_image = cv2.cvtColor(decolorized_image, cv2.COLOR_BGR2HSV)
    elif processing_mode == "gray-min":
        b, g, r = cv2.split(rotated_img)
        min_values = np.minimum(np.minimum(b, g), r)
        decolorized_image = cv2.merge([min_values, min_values, min_values])
        hsv_image = cv2.cvtColor(decolorized_image, cv2.COLOR_BGR2HSV)
    elif processing_mode == "gray-min-invert":
        b, g, r = cv2.split(rotated_img)
        min_values = np.minimum(np.minimum(b, g), r)
        decolorized_image = cv2.merge([min_values, min_values, min_values])
        hsv_image = cv2.cvtColor(decolorized_image, cv2.COLOR_BGR2HSV)
        hsv_image = cv2.bitwise_not(hsv_image)

    # Apply channel thresholds
    thresholded_img = apply_channel_thresholds(
        hsv_image,
        hue_thresh=hue_thresh,
        sat_thresh=sat_thresh,
        value_thresh=value_thresh,
    )

    # Scale image and points
    scaled_img = scale_image(thresholded_img, params.scale_factor)
    scaled_points = roi_points * params.scale_factor
    scaled_points_int = scaled_points.astype(int)
    if params.type == "square":
        # Compute block and gap sizes
        block_size, gap_size = calculate_grid_dimensions(
            (side_length_x * params.scale_factor, side_length_y * params.scale_factor),
            params.grid_size,
            params.gap_ratio,
        )

        # Detect active blocks
        binary_matrix = detect_blocks(
            scaled_img,
            scaled_points[0],
            block_size,
            gap_size,
            params.grid_size,
            params.activation_threshold,
        )

        # Denoise binary matrix
        cleaned_matrix = denoise_with_dbscan(
            binary_matrix, params.dbscan_eps, params.dbscan_min_samples
        )

        return (
            cv2.cvtColor(
                scaled_img[
                    scaled_points_int[:, 1].min() : scaled_points_int[:, 1].max(),
                    scaled_points_int[:, 0].min() : scaled_points_int[:, 0].max(),
                ],
                cv2.COLOR_HSV2BGR,
            ),
            cleaned_matrix,
            {
                "side_length": side_length,
                "gap_size": gap_size,
                "block_size": block_size,
                "rect_hull": rect_hull,
            },
            rect_hull,
        )
    elif params.type == "dy" or params.type == "ld":
        ratio = calculate_circle_ratio(
            side_length_x * params.scale_factor, params.grid_size[0]
        )

        print("side_x", side_length_x, side_length_y, ratio)
        gap_size = (100 * ratio, 85 * ratio)
        r = 40.0 / 2 * ratio
        print("gap_size and r:", gap_size, r)

        # DY grids are laid out from the top-left corner using an X-derived ratio.
        # When the source ROI is square, the theoretical DY height can be smaller
        # than the cropped square height, which leaves a blank band at the bottom.
        used_height_scaled = 2 * r + (params.grid_size[1] - 1) * gap_size[1]
        crop_height = min(side_length_y, used_height_scaled / params.scale_factor)
        rect_hull = np.array(
            [
                aligned_points[0],
                aligned_points[0] + np.array([0, crop_height]),
                aligned_points[0] + np.array([side_length_x, crop_height]),
                aligned_points[0] + np.array([side_length_x, 0]),
            ],
            dtype=int,
        )
        scaled_rect_points_int = (rect_hull * params.scale_factor).astype(int)

        binary_matrix = detect_circle_blocks(
            scaled_img,
            scaled_points[0],
            gap_size,
            params.grid_size,
            r,
            params.activation_threshold,
            params.block_threshold,
        )
        return (
            cv2.cvtColor(
                scaled_img[
                    scaled_rect_points_int[:, 1].min() : scaled_rect_points_int[:, 1].max(),
                    scaled_rect_points_int[:, 0].min() : scaled_rect_points_int[:, 0].max(),
                ],
                cv2.COLOR_HSV2BGR,
            ),
            binary_matrix,
            {
                "side_length": side_length_y,
                "side_length_x": side_length_x,
                "side_length_y": side_length_y,
                "gap_size": gap_size,
                "r": r,
            },
            rect_hull,
        )
    elif params.type == "s3000":
        grid_size = (1426, 1656)
        total_length_x = side_length_x * params.scale_factor
        total_length_y = side_length_y * params.scale_factor

        # Use chip edges as boundaries; first spot center is ~1 pitch/row height in.
        gap_x = total_length_x / (grid_size[0] + 1)
        gap_y = total_length_y / (grid_size[1] + 1)

        spot_radius = gap_x * (1.25 / 3.5)

        binary_matrix = detect_hex_spots(
            scaled_img,
            scaled_points[0],
            grid_size,
            (gap_x, gap_y),
            spot_radius,
            params.activation_threshold,
            params.block_threshold,
            margin=(gap_x, gap_y),
        )

        return (
            cv2.cvtColor(
                scaled_img[
                    scaled_points_int[:, 1].min() : scaled_points_int[:, 1].max(),
                    scaled_points_int[:, 0].min() : scaled_points_int[:, 0].max(),
                ],
                cv2.COLOR_HSV2BGR,
            ),
            binary_matrix,
            {
                "side_length": side_length_y,
                "side_length_x": side_length_x,
                "side_length_y": side_length_y,
                "gap_size": (gap_x, gap_y),
                "r": spot_radius,
                "grid_size": grid_size,
            },
            rect_hull,
        )


def calculate_circle_ratio(total_length_x: float, grid_size_x: int) -> float:
    # For staggered rows, gap_x denotes center-to-center spacing along X.
    # Layout span: left radius + (n-1)*gap_x + 0.5*gap_x (odd-row offset) + right radius
    # => span = (grid_size_x - 0.5) * 100 * ratio + 40 * ratio
    # So ratio = total_length_x / (100 * grid_size_x - 10)
    ratio = total_length_x / (100 * grid_size_x - 10)
    return ratio


def detect_circle_blocks(
    image: MatLike,
    origin: MatLike,
    gap_size: Tuple[float, float],
    grid_size: Tuple[int, int],
    radius: float,
    activation_thresh: float,
    pixel_threshold: int = 135,
) -> MatLike:
    """Detect active circle blocks on a staggered (hex-like) grid.

    The grid uses an offset on every odd row to mimic the actual physical layout
    of circular wells. We evaluate activation inside a circular mask rather than
    the full square ROI to avoid counting background pixels.
    """

    gap_x, gap_y = gap_size
    grid_x, grid_y = grid_size
    origin_x, origin_y = origin
    radius_px = max(1, int(round(radius)))
    binary_matrix = np.zeros(grid_size, dtype=np.uint8)
    img_h, img_w = image.shape[:2]

    for row in range(grid_y):
        row_offset_x = (gap_x / 2.0) if row % 2 else 0.0
        center_y = origin_y + radius_px + row * gap_y

        for col in range(grid_x):
            center_x = origin_x + radius_px + col * gap_x + row_offset_x

            x0 = int(np.floor(center_x - radius_px))
            x1 = int(np.ceil(center_x + radius_px))
            y0 = int(np.floor(center_y - radius_px))
            y1 = int(np.ceil(center_y + radius_px))

            if x1 <= 0 or y1 <= 0 or x0 >= img_w or y0 >= img_h:
                continue

            x0_clamped = max(x0, 0)
            y0_clamped = max(y0, 0)
            x1_clamped = min(x1, img_w)
            y1_clamped = min(y1, img_h)

            roi = image[y0_clamped:y1_clamped, x0_clamped:x1_clamped]
            if roi.size == 0:
                continue

            mask = np.zeros(roi.shape[:2], dtype=np.uint8)
            cx_local = int(round(center_x - x0_clamped))
            cy_local = int(round(center_y - y0_clamped))

            if not (0 <= cx_local < mask.shape[1] and 0 <= cy_local < mask.shape[0]):
                continue

            cv2.circle(mask, (cx_local, cy_local), radius_px, 255, -1)

            if is_active_circle_block(roi, mask, activation_thresh, pixel_threshold):
                # Keep same orientation as square grid: first index is X/col.
                binary_matrix[col, row] = 1

    return binary_matrix


def detect_hex_spots(
    image: MatLike,
    origin: MatLike,
    grid_size: Tuple[int, int],
    gap_size: Tuple[float, float],
    radius: float,
    activation_thresh: float,
    pixel_threshold: int = 135,
    margin: Optional[Tuple[float, float]] = None,
) -> MatLike:
    """Detect active spots on a hexagonal grid using a circular kernel."""

    gap_x, gap_y = gap_size
    grid_x, grid_y = grid_size
    origin_x, origin_y = origin
    margin_x, margin_y = margin if margin is not None else (radius, radius)

    start_x = origin_x + margin_x
    start_y = origin_y + margin_y

    intensity = image[:, :, 2] if image.ndim == 3 else image
    # OpenCV builds can reject uint8 -> CV_32S filter2D combos.
    # Use float32 throughout to stay compatible.
    active = (intensity > pixel_threshold).astype(np.float32)

    radius_px = max(1, int(round(radius)))
    yy, xx = np.ogrid[-radius_px : radius_px + 1, -radius_px : radius_px + 1]
    circle_mask = (xx * xx + yy * yy) <= radius_px * radius_px
    kernel = circle_mask.astype(np.float32)
    kernel_area = float(circle_mask.sum())

    filtered = cv2.filter2D(
        active, cv2.CV_32F, kernel, borderType=cv2.BORDER_CONSTANT
    )

    binary_matrix = np.zeros(grid_size, dtype=np.uint8)
    cols = np.arange(grid_x)
    base_x = start_x + cols * gap_x
    x_even = np.rint(base_x).astype(int)
    x_odd = np.rint(base_x + (gap_x / 2.0)).astype(int)

    img_h, img_w = intensity.shape[:2]
    for row in range(grid_y):
        center_y = int(round(start_y + row * gap_y))
        if center_y < 0 or center_y >= img_h:
            continue

        xs = x_odd if row % 2 else x_even
        valid = (xs >= 0) & (xs < img_w)
        if not np.any(valid):
            continue

        xs_valid = xs[valid]
        cols_valid = cols[valid]
        active_ratio = filtered[center_y, xs_valid] / kernel_area
        binary_matrix[cols_valid, row] = (active_ratio > activation_thresh).astype(
            np.uint8
        )

    return binary_matrix


def is_active_circle_block(
    block_pixels: MatLike,
    mask: MatLike,
    threshold: float,
    pixel_threshold: int = 135,
) -> bool:
    """Check activation level within a circular ROI defined by ``mask``.

    Args:
        block_pixels: ROI pixels (H, W[, C])
        mask: Single-channel mask where the circle area is non-zero
        threshold: Activation ratio threshold
        pixel_threshold: Pixel intensity cutoff used to decide if a pixel is active

    Returns:
        True if the fraction of active pixels inside the circle exceeds ``threshold``.
    """
    # Work on a single channel to avoid counting triplicate values from HSV/BGR
    intensity = block_pixels[:, :, 2] if block_pixels.ndim == 3 else block_pixels

    masked_pixels = intensity[mask > 0]
    if masked_pixels.size == 0:
        return False

    active_ratio = np.mean(masked_pixels > pixel_threshold)
    return active_ratio > threshold
