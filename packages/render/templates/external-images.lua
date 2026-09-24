-- Marks remote images data-external so --embed-resources only inlines local files.
function Image(image)
  if image.src:match("^%a[%w+.-]*:") or image.src:match("^//") then
    image.attributes["data-external"] = "1"
  end
  return image
end
