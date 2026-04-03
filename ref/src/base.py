from itertools import combinations
from pathlib import Path
from typing import Optional, Tuple
import cv2
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from cv2.typing import MatLike

from .constant import (
    CANNY_THRESHOLDS,
    EDGE_LENGTH_TOLERANCE,
    HOUGH_PARAMS,
    LINE_EXTENSION_MULTIPLIER,
    RADIAN_TOLERANCE,
    ProcessingParams,
)
from .rectangle import (
    check_rectangle_validity,
    compute_line_intersections,
    extend_line_segments,
    get_valid_lines,
    group_intersection_points,
)
from .tissue import scale_image, sort_points_clockwise, rotate_image


class BaseImage:
    def __init__(
        self,
        image_path: str,
        /,
        *,
        threshold: int = 0,
        rotate: int = 0,
        scale: float = 1.0,
        debug: bool = False,
    ) -> None:
        """Initialize the BaseImage class with the given image path and threshold.

        Args:
            image_path (str): Path to the image file.
            threshold (int, optional): Threshold value for binary conversion. Defaults to 0.
            rotate (int, optional): Rotation angle in degrees. Defaults to 0.
            scale (float, optional): Scale factor for image resizing. Defaults to 1.0.
            debug(bool, optional): Flag to enable debug mode, it will save intermediate images. Defaults to False.

        Raises:
            AssertionError: If the image format is not supported or the threshold value is invalid.
            FileNotFoundError: If the image cannot be read from the given path.
        """

        assert Path(image_path).suffix.lower() in [
            ".bmp",
            ".jpg",
            ".jpeg",
            ".png",
        ], "Invalid image format"
        assert 0 <= threshold <= 255, "Threshold value must be between 0 and 255"

        self.debug = debug
        self.name = Path(image_path).stem
        self._image_path = image_path
        self._threshold = threshold
        self._img_raw = self._load_image(scale, rotate)
        self._img_rgb, self._img_gray, self._img_bin = self._convert_images()

    def _load_image(self, scale: float = 1.0, rotate: float = 0) -> MatLike:
        """Load the image from the given path, then apply scaling and rotation transformations if needed.

        Args:
            scale (float, optional): Scale factor for image resizing. Defaults to 1.0.
            rotate (float, optional): Rotation angle in degrees. Defaults to 0.

        Returns:
            MatLike: The loaded image.

        Raises:
            FileNotFoundError: If the image cannot be read from the given path.
            RuntimeError: If there is an error processing the image.
        """
        try:
            img = cv2.imread(self._image_path)
            if img is None:
                raise FileNotFoundError(f"Unable to read image at {self._image_path}")
            img = scale_image(img, scale)
            img = rotate_image(img, rotate)
            return img
        except Exception as e:
            raise RuntimeError(f"Error processing image: {str(e)}")

    def _convert_images(self) -> tuple[MatLike, MatLike, MatLike]:
        """Convert the raw image to RGB, grayscale, and binary formats.

        Returns:
            tuple[MatLike, MatLike, MatLike]: A tuple containing the RGB, grayscale, and binary images.
        """
        try:
            img_rgb = cv2.cvtColor(self._img_raw, cv2.COLOR_BGR2RGB)
            img_gray = cv2.cvtColor(self._img_raw, cv2.COLOR_BGR2GRAY)
            _, img_bin = cv2.threshold(
                img_gray, self._threshold, 255, cv2.THRESH_BINARY
            )
            return img_rgb, img_gray, img_bin
        except Exception as e:
            raise RuntimeError(f"Error converting images: {str(e)}")

    @property
    def img_raw(self) -> MatLike:
        """Get the raw image."""
        return self._img_raw

    @property
    def img_rgb(self) -> MatLike:
        """Get the RGB image."""
        return self._img_rgb

    @property
    def img_gray(self) -> MatLike:
        """Get the grayscale image."""
        return self._img_gray

    @property
    def img_bin(self) -> MatLike:
        """Get the binary image."""
        return self._img_bin

    def display_images(self, save_path: Optional[str] = None) -> None:
        """Display or save the raw, RGB, grayscale, and binary images.

        Args:
            save_path (Optional[str], optional): Path to save the plot as an image, if not provided, the plot will be shown. Defaults to None.
        """
        fig, axes = plt.subplots(1, 4, tight_layout=True, figsize=(16, 10))
        axes[0].imshow(self.img_raw)
        axes[0].set_title("Raw")
        axes[1].imshow(self.img_rgb)
        axes[1].set_title("RGB")
        axes[2].imshow(self.img_gray, cmap="gray")
        axes[2].set_title("Grayscale")
        axes[3].imshow(self.img_bin, cmap="gray")
        axes[3].set_title("Binary")
        if save_path is None:
            plt.show()
        else:
            fig.savefig(save_path)

    def get_img_with_mode(self, mode: str = "raw") -> MatLike:
        """Get the image with the specified mode.

        Args:
            mode (str, optional): One of "raw", "rgb", "gray", or "bin", the image mode to return.  Defaults to "raw".

        Returns:
            MatLike: The image in the specified mode.

        Raise:
            AssertionError: If the mode is invalid.
        """
        assert mode in ["raw", "rgb", "gray", "bin", "inverse"], "Invalid mode"

        match mode:
            case "raw":
                return self.img_raw
            case "rgb":
                return self.img_rgb
            case "gray":
                return self.img_gray
            case "bin":
                return self.img_bin
            case "inverse":
                return cv2.bitwise_not(self.img_raw)

    def crop_image(self, hull: MatLike, mode: str = "raw") -> MatLike:
        """Crop the image using the convex hull points.

        Args:
            hull (MatLike): Convex hull points of the rectangle to crop.
            mode (str, optional): The image mode to use for cropping. Defaults to "raw".

        Returns:
            MatLike: The cropped image.

        Raise:
            AssertionError: If the mode is invalid or the hull shape is invalid.
        """
        assert mode in ["raw", "rgb", "gray", "bin"], "Invalid mode"
        assert hull.shape == (4, 2), "Invalid hull shape"

        img = self.get_img_with_mode(mode)
        x_min = hull[:, 0].min()
        x_max = hull[:, 0].max()
        y_min = hull[:, 1].min()
        y_max = hull[:, 1].max()

        return img[y_min:y_max, x_min:x_max]

    def close_plots(self) -> None:
        """Close all matplotlib windows."""
        plt.close("all")

    def find_largest_rectangle(
        self,
        mode: str = "bin",
        tolerance: float = RADIAN_TOLERANCE,
    ) -> Optional[MatLike]:
        """Detect and return the largest rectangle in the image.

        Args:
            mode(str, optional): The image mode to use for rectangle detection.
                Defaults to "bin".
            tolerance (float, optional): The tolerance range in radians for angle
                comparisons. Any line within this range is considered parallel or
                perpendicular. Defaults to RADIAN_TOLERANCE.

        Returns:
            Optional[MatLike]: Convex hull points of the largest detected rectangle,
                or None if no valid rectangle is found.
        Raise:
            AssertionError: If the mode is invalid.

        Note:
            The detection process involves:
            1. Edge detection using Canny algorithm
            2. Line detection using Hough transform
            3. Filtering horizontal and vertical lines
            4. Finding intersections of perpendicular lines
            5. Clustering nearby intersections
            6. Finding the largest valid rectangle among potential quads
        """
        assert mode in ["raw", "rgb", "gray", "bin", "inverse"], "Invalid mode"
        img = self.get_img_with_mode(mode)
        edges = cv2.Canny(img, *CANNY_THRESHOLDS, apertureSize=3, L2gradient=True)
        lines = cv2.HoughLinesP(edges, **HOUGH_PARAMS)
        if lines is None:
            return None

        valid_lines = get_valid_lines(lines, tolerance)
        extended_lines = extend_line_segments(valid_lines, LINE_EXTENSION_MULTIPLIER)
        intersections = compute_line_intersections(extended_lines, tolerance)
        if not intersections:
            return None

        grouped_points = group_intersection_points(intersections)

        best_hull = None
        max_edge_length = float("-inf")

        for quad in combinations(grouped_points, 4):
            hull = cv2.convexHull(np.array(quad, dtype=np.int32))
            hull_points = hull.reshape(-1, 2)

            if check_rectangle_validity(hull_points, tolerance):
                edge_lengths = [
                    np.linalg.norm(
                        hull_points[i] - hull_points[(i + 1) % len(hull_points)]
                    )
                    for i in range(len(hull_points))
                ]
                edge_difference = np.sum(np.abs(np.diff(edge_lengths)))
                if (
                    edge_difference < EDGE_LENGTH_TOLERANCE
                    and max(edge_lengths) > max_edge_length
                ):
                    max_edge_length = max(edge_lengths)
                    best_hull = hull

        if best_hull is not None:
            best_hull = np.array(best_hull).reshape(-1, 2)
            best_hull = sort_points_clockwise(best_hull)

        # DEBUG: visualize intermediate results when enabled
        if self.debug:
            show_img = self.img_raw.copy()
            for line in extended_lines:
                x1, y1, x2, y2 = line[0]
                cv2.line(show_img, (x1, y1), (x2, y2), (0, 255, 0), 2)
            for point in intersections:
                cv2.circle(show_img, (point.x, point.y), 5, (0, 0, 255), -1)
            if best_hull is not None:
                hull_points = best_hull.reshape(-1, 2)
                x_min = hull_points[:, 0].min()
                x_max = hull_points[:, 0].max()
                y_min = hull_points[:, 1].min()
                y_max = hull_points[:, 1].max()
                for y in range(y_min, y_max + 1, 10):
                    cv2.line(show_img, (x_min, y), (x_max, y), (0, 224, 224), 2)
                for x in range(x_min, x_max + 1, 10):
                    cv2.line(show_img, (x, y_min), (x, y_max), (0, 224, 224), 2)

            cv2.imwrite(f"{self.name}_cropped_process.png", show_img)
        return best_hull

    def show_cropped_tissue(
        self,
        hull: MatLike,
        matrix: MatLike,
        scale_factor: int,
        grid_size: Tuple[float, float],
        gap_size: Tuple[float, float],
        block_size: Tuple[float, float],
        save_path: str,
    ) -> None:
        """Render and save the cropped tissue overlay for quick inspection."""

        show_img = self.get_cropped_tissue(
            hull, matrix, scale_factor, grid_size, gap_size, block_size
        )
        cv2.imwrite(save_path, show_img)

    def get_cropped_tissue(
        self,
        hull: MatLike,
        matrix: MatLike,
        scale_factor: int,
        grid_size: Tuple[float, float],
        gap_size: Tuple[float, float],
        block_size: Tuple[float, float] | None = None,
        r: float | None = None,
        type="square",
    ) -> MatLike:
        """Get the cropped tissue image with the given matrix.

        Args:
            hull (MatLike): Convex hull points of the rectangle to crop.
            matrix (MatLike): The matrix representing the tissue grid.
            scale_factor (int): The scale factor for resizing the image.
            grid_size (Tuple[float, float]): The count of the grid, e.g., 64 for 64x64, 96 for 96x96.
            gap_size (Tuple[float, float]): The gap size between blocks.
            block_size (Tuple[float, float]): The size of each block.

        Returns:
            MatLike: The cropped tissue image with the grid and blocks.
        """
        show_img = self.crop_image(hull, "raw")
        show_img = scale_image(show_img, scale_factor)
        grid_size_x, grid_size_y = grid_size
        gap_size_x, gap_size_y = gap_size
        if type == "square":
            block_size_x, block_size_y = block_size
            for col in range(grid_size_x):
                for row in range(grid_size_y):
                    y_start = (gap_size_y + block_size_y) * row + gap_size_y
                    x_start = (gap_size_x + block_size_x) * col + gap_size_x

                    y_end = y_start + block_size_y
                    x_end = x_start + block_size_x

                    if matrix[col, row] == 1:
                        cv2.rectangle(
                            show_img,
                            np.int64((x_start, y_start)),
                            np.int64((x_end, y_end)),
                            (0, 0, 255),
                            -1,
                        )
        if type == "dy" or type == "ld":
            # Pad canvas so edge circles aren't clipped by tight crops.
            pad = int(np.ceil(r)) if r is not None else 0
            if pad > 0:
                show_img = cv2.copyMakeBorder(
                    show_img,
                    pad,
                    pad,
                    pad,
                    pad,
                    borderType=cv2.BORDER_CONSTANT,
                    value=0,
                )

            print(int(r))
            print(gap_size, r)
            for row in range(grid_size_y):
                for col in range(grid_size_x):
                    c_center_x = (
                        pad + r + col * gap_size_x + ((row % 2) * (gap_size_x / 2.0))
                    )
                    c_center_y = pad + r + row * gap_size_y
                    if matrix[col, row] == 1:
                        cv2.circle(
                            show_img,
                            np.int64((c_center_x, c_center_y)),
                            np.int64(r),
                            (0, 0, 255),
                            -1,
                        )
        if type == "s3000":
            if r is None:
                return show_img
            margin_x = gap_size_x
            margin_y = gap_size_y
            for row in range(grid_size_y):
                row_offset = (row % 2) * (gap_size_x / 2.0)
                c_center_y = margin_y + row * gap_size_y
                for col in range(grid_size_x):
                    c_center_x = margin_x + col * gap_size_x + row_offset
                    if matrix[col, row] == 1:
                        cv2.circle(
                            show_img,
                            np.int64((c_center_x, c_center_y)),
                            np.int64(r),
                            (0, 0, 255),
                            -1,
                        )

        return show_img


__all__ = ["BaseImage"]

if __name__ == "__main__":
    from .tissue import ProcessingParams, process_image

    try:
        data = BaseImage("data/2025.01.22-mS-6-OHDA-test.bmp", threshold=0, debug=True)
        data.display_images("dbg.png")
        hull = data.find_largest_rectangle("bin")
        cropped_img = data.crop_image(hull, "raw")
        cv2.imwrite("dbg_cropped.png", cropped_img)

        params = ProcessingParams(
            scale_factor=1.0,
            grid_size=(64, 64),
            activation_threshold=0.05,
            dbscan_min_samples=2,
        )
        _, matrix, res = process_image(
            data.img_raw,
            hull,
            params=params,
            thresholds={"saturation": 70, "hue": None, "value": None},
        )
        side_length, gap_size, block_size = (
            res["side_length"],
            res["gap_size"],
            res["block_size"],
        )
        pd.DataFrame(matrix).to_csv(
            f"result/{data.name}.csv", index=False, header=False
        )
        data.show_cropped_tissue(
            hull,
            matrix,
            params.scale_factor,
            params.grid_size,
            gap_size,
            block_size,
            "dbg_tissue.png",
        )
    except Exception as e:
        print(f"An error occurred: {str(e)}")
    finally:
        data.close_plots()
